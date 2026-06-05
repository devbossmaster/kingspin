import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RoomStatus, RoundStatus } from '@kingspin/db';
import { getApiEnv } from '../../config/api-env';
import { RoomGateway } from '../../gateways/room.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { RoundMachineLockService } from './round-machine-lock.service';
import { ROUND_MACHINE_TIMINGS_MS } from './public-round-phase';
import { RoundsService } from './rounds.service';

const ACTIVE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

const MACHINE_TIMINGS_MS = ROUND_MACHINE_TIMINGS_MS;
const ROUND_MACHINE_TIMING_WARN_THRESHOLD_MS = 300;
const ROUND_MACHINE_TICK_QUEUE_WARN_THRESHOLD_MS = 300;
const ROUND_MACHINE_STALE_PHASE_BUFFER_MS = 10_000;
const ROUND_MACHINE_STALE_LOG_THROTTLE_MS = 60_000;
const AUTO_START_CONCURRENCY = 2;
const ROUND_MACHINE_NORMAL_TICK_CONCURRENCY = 2;
const ROUND_MACHINE_URGENT_TICK_CONCURRENCY = 3;
const ROUND_MACHINE_TICK_PRIORITIES = {
  CATCH_UP: 0,
  START: 1,
  SCHEDULED: 5,
} as const;

export type AdvanceRoomOptions = {
  force?: boolean;
};

type MachineRuntimeState = {
  roomId: string;
  isRunning: boolean;
  tickCount: number;
  lastAction: string | null;
  lastError: string | null;
  lastTickAt: Date | null;
  nextTickAt: Date | null;
};

type QueuedRoomTick = {
  roomId: string;
  options: AdvanceRoomOptions;
  priority: number;
  sequence: number;
  enqueuedAt: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

type RoundMachineDiagnosticsRoom = {
  id: string;
  code: string;
  rounds: Array<{
    id: string;
    roundNumber: number;
    status: RoundStatus;
    openedAt: Date;
    locksAt: Date | null;
    lockedAt: Date | null;
    drawingAt: Date | null;
    spinningAt: Date | null;
    settlingAt: Date | null;
    completedAt: Date | null;
    cancelledAt: Date | null;
    updatedAt: Date;
  }>;
};

type RoundMachineDiagnosticWarning = {
  reason:
    | 'COMPLETED_PAST_COOLDOWN'
    | 'NO_ROUNDS_FOR_ACTIVE_PERMANENT_ROOM'
    | 'NO_CURRENT_ACTIVE_ROUND'
    | 'STALE_LOCKED_ROUND'
    | 'STALE_DRAWING_ROUND'
    | 'STALE_SPINNING_ROUND'
    | 'STALE_SETTLING_ROUND';
  roomId: string;
  roomCode: string;
  roundId: string | null;
  roundNumber: number | null;
  status: RoundStatus | null;
  ageMs: number | null;
  thresholdMs: number | null;
  machineRunning: boolean;
  lastTickAt: string | null;
};

@Injectable()
export class RoundMachineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoundMachineService.name);

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly states = new Map<string, MachineRuntimeState>();
  private readonly ticksInFlight = new Map<string, Promise<any>>();
  private readonly catchUpsInFlight = new Map<string, Promise<any>>();
  private readonly queuedTicksByRoom = new Map<string, QueuedRoomTick>();
  private readonly pendingTickQueue: QueuedRoomTick[] = [];
  private readonly diagnosticWarningLastLoggedAt = new Map<string, number>();
  private activeTickExecutions = 0;
  private tickQueueSequence = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly roundsService: RoundsService,
    private readonly roomGateway: RoomGateway,
    private readonly roundMachineLockService: RoundMachineLockService,
  ) {}

  onModuleInit() {
    const env = getApiEnv();
    const shouldAutoStart = env.ROUND_MACHINE_AUTO_START === true;

    if (!shouldAutoStart) {
      this.logger.log(
        'Round machine auto-start disabled. Set ROUND_MACHINE_AUTO_START=true to enable.',
      );
      return;
    }

    setTimeout(() => {
      void this.autoStartPermanentActiveRooms();
    }, 1_000);
  }

  onModuleDestroy() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();

    for (const queuedTick of this.pendingTickQueue.splice(0)) {
      queuedTick.reject(new Error('Round machine is shutting down.'));
    }

    this.queuedTicksByRoom.clear();
  }

  async startRoomMachine(roomId: string) {
    await this.assertRoomCanRun(roomId);

    const existingState = this.states.get(roomId);

    if (existingState?.isRunning) {
      await this.runRoomTickImmediately(
        roomId,
        { force: false },
        {
          priority: ROUND_MACHINE_TICK_PRIORITIES.CATCH_UP,
        },
      );
      return this.getRoomMachineStatus(roomId);
    }

    const state: MachineRuntimeState = {
      roomId,
      isRunning: true,
      tickCount: existingState?.tickCount ?? 0,
      lastAction: existingState?.lastAction ?? null,
      lastError: null,
      lastTickAt: existingState?.lastTickAt ?? null,
      nextTickAt: new Date(),
    };

    this.states.set(roomId, state);
    await this.runRoomTickImmediately(
      roomId,
      { force: false },
      {
        skipIfStopped: false,
        priority: ROUND_MACHINE_TICK_PRIORITIES.START,
      },
    );

    return this.getRoomMachineStatus(roomId);
  }

  requestRoomCatchUp(roomId: string, reason = 'CATCH_UP_REQUESTED') {
    if (!roomId) {
      return;
    }

    if (this.catchUpsInFlight.has(roomId)) {
      return;
    }

    const catchUp = this.catchUpRoomMachine(roomId, reason)
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unknown catch-up error';

        this.logger.warn(
          `Room machine catch-up failed for ${roomId} reason=${reason}: ${message}`,
        );
      })
      .finally(() => {
        if (this.catchUpsInFlight.get(roomId) === catchUp) {
          this.catchUpsInFlight.delete(roomId);
        }
      });

    this.catchUpsInFlight.set(roomId, catchUp);
  }

  requestExpiredEmptyOpenRoundCatchUp(
    roomId: string,
    roundId: string,
    reason = 'EXPIRED_EMPTY_OPEN_CATCH_UP_REQUESTED',
  ) {
    if (!roomId || !roundId) {
      return;
    }

    if (this.catchUpsInFlight.has(roomId)) {
      return;
    }

    const catchUp = this.catchUpExpiredEmptyOpenRound(roomId, roundId, reason)
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown empty catch-up error';

        this.logger.warn(
          `Room machine empty-open catch-up failed for ${roomId} reason=${reason}: ${message}`,
        );
      })
      .finally(() => {
        if (this.catchUpsInFlight.get(roomId) === catchUp) {
          this.catchUpsInFlight.delete(roomId);
        }
      });

    this.catchUpsInFlight.set(roomId, catchUp);
  }

  async catchUpRoomMachine(roomId: string, reason = 'CATCH_UP_REQUESTED') {
    const startedAt = Date.now();

    await this.assertRoomCanRun(roomId);

    const existingState = this.states.get(roomId);

    if (!existingState?.isRunning) {
      const state: MachineRuntimeState = {
        roomId,
        isRunning: true,
        tickCount: existingState?.tickCount ?? 0,
        lastAction: existingState?.lastAction ?? null,
        lastError: null,
        lastTickAt: existingState?.lastTickAt ?? null,
        nextTickAt: new Date(),
      };

      this.states.set(roomId, state);
    }

    const result = await this.runRoomTickImmediately(
      roomId,
      { force: false },
      {
        skipIfStopped: false,
        priority: ROUND_MACHINE_TICK_PRIORITIES.CATCH_UP,
      },
    );
    const durationMs = Date.now() - startedAt;

    if (durationMs >= ROUND_MACHINE_TIMING_WARN_THRESHOLD_MS) {
      this.logger.warn(
        `[round-machine-catchup:${roomId}] reason=${reason} duration=${durationMs}ms action=${result?.action ?? 'NO_ACTION'} dbWaitMayBeIncluded=true`,
      );
    }

    return result;
  }

  async catchUpExpiredEmptyOpenRound(
    roomId: string,
    roundId: string,
    reason = 'EXPIRED_EMPTY_OPEN_CATCH_UP_REQUESTED',
  ) {
    const startedAt = Date.now();
    const existingTick = this.ticksInFlight.get(roomId);

    if (existingTick) {
      this.raiseQueuedTickPriority(
        roomId,
        ROUND_MACHINE_TICK_PRIORITIES.CATCH_UP,
      );
      return existingTick;
    }

    const existingState = this.states.get(roomId);

    if (!existingState?.isRunning) {
      const state: MachineRuntimeState = {
        roomId,
        isRunning: true,
        tickCount: existingState?.tickCount ?? 0,
        lastAction: existingState?.lastAction ?? null,
        lastError: null,
        lastTickAt: existingState?.lastTickAt ?? null,
        nextTickAt: new Date(),
      };

      this.states.set(roomId, state);
    }

    this.clearScheduledTick(roomId);

    const result = await this.executeRoomTickWithAdvance(
      roomId,
      { force: false },
      async () => {
        const lockResult = await this.roundMachineLockService.withRoomTickLock(
          roomId,
          async () => {
            const fastResult =
              await this.roundsService.cancelExpiredEmptyOpenRoundAndStartNextForRoom(
                roomId,
                roundId,
              );

            if (fastResult) {
              return {
                action: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
                roomId,
                cancelledRound: fastResult.cancelledRound,
                currentRound: fastResult.currentRound,
                refundSummary: fastResult.refundSummary,
                force: false,
              };
            }

            return this.advanceRoomOnceLocked(roomId, { force: false });
          },
        );

        if (!lockResult.acquired) {
          this.logLeaderSkip(
            roomId,
            { force: false },
            lockResult.reason,
            'expired-empty-open-catchup-lock-not-acquired',
          );

          return this.toLeaderSkipResult(
            roomId,
            { force: false },
            lockResult.reason,
          );
        }

        return lockResult.result;
      },
    );
    const durationMs = Date.now() - startedAt;

    if (durationMs >= ROUND_MACHINE_TIMING_WARN_THRESHOLD_MS) {
      this.logger.warn(
        `[round-machine-catchup:${roomId}] reason=${reason} duration=${durationMs}ms action=${result?.action ?? 'NO_ACTION'} mode=expired-empty-open dbWaitMayBeIncluded=true`,
      );
    }

    return result;
  }

  async stopRoomMachine(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const timer = this.timers.get(roomId);

    if (timer) {
      clearTimeout(timer);
      this.timers.delete(roomId);
    }

    const state = this.getOrCreateState(roomId);
    state.isRunning = false;
    state.nextTickAt = null;

    this.states.set(roomId, state);

    return this.getRoomMachineStatus(roomId);
  }

  async getRoomMachineStatus(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const state = this.getOrCreateState(roomId);

    const [currentRound, latestRound] = await Promise.all([
      this.prisma.round.findFirst({
        where: {
          roomId,
          status: { in: ACTIVE_ROUND_STATUSES },
        },
        orderBy: { roundNumber: 'desc' },
      }),
      this.prisma.round.findFirst({
        where: { roomId },
        orderBy: { roundNumber: 'desc' },
      }),
    ]);

    const visibleCurrentRound = this.getVisibleStatusRound(
      currentRound,
      latestRound,
      new Date(),
    );

    return {
      roomId,
      isRunning: state.isRunning,
      tickCount: state.tickCount,
      lastAction: state.lastAction,
      lastError: state.lastError,
      lastTickAt: state.lastTickAt?.toISOString() ?? null,
      nextTickAt: state.nextTickAt?.toISOString() ?? null,
      currentRound: visibleCurrentRound
        ? this.roundsService.toRoundSnapshot(visibleCurrentRound)
        : null,
      latestRound: latestRound
        ? this.roundsService.toRoundSnapshot(latestRound)
        : null,
      timings: MACHINE_TIMINGS_MS,
    };
  }

  async getRoundMachineHealthSnapshot(options: { logWarnings?: boolean } = {}) {
    const env = getApiEnv();
    const now = new Date();
    const runtime = this.getRuntimeHealthSnapshot();

    const [activeRoomsCount, activePermanentRooms] = await Promise.all([
      this.prisma.room.count({
        where: {
          status: RoomStatus.ACTIVE,
        },
      }),
      this.prisma.room.findMany({
        where: {
          status: RoomStatus.ACTIVE,
          isPermanent: true,
        },
        select: {
          id: true,
          code: true,
          rounds: {
            orderBy: { roundNumber: 'desc' },
            take: 1,
            select: {
              id: true,
              roundNumber: true,
              status: true,
              openedAt: true,
              locksAt: true,
              lockedAt: true,
              drawingAt: true,
              spinningAt: true,
              settlingAt: true,
              completedAt: true,
              cancelledAt: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { code: 'asc' },
      }),
    ]);

    const staleDiagnostics = this.buildStaleRoundDiagnostics(
      activePermanentRooms as RoundMachineDiagnosticsRoom[],
      now,
    );

    if (options.logWarnings === true) {
      this.logStaleRoundDiagnostics(staleDiagnostics.warnings, now);
    }

    const runningPermanentRooms = activePermanentRooms.filter(
      (room) => this.states.get(room.id)?.isRunning === true,
    ).length;

    return {
      enabled: env.ROUND_MACHINE_AUTO_START === true,
      running: runtime.runningRooms > 0,
      startupMode:
        env.ROUND_MACHINE_AUTO_START === true ? 'auto-start' : 'manual',
      instance: {
        id: this.getInstanceId(),
        pid: process.pid,
      },
      lastTickAt: runtime.lastTickAt,
      nextTickAt: runtime.nextTickAt,
      timings: MACHINE_TIMINGS_MS,
      runtime,
      leaderLock: this.roundMachineLockService.getLeadershipSnapshot(),
      rooms: {
        active: activeRoomsCount,
        activePermanent: activePermanentRooms.length,
        runningPermanent: runningPermanentRooms,
      },
      staleRounds: staleDiagnostics.counts,
      staleThresholdsMs: staleDiagnostics.thresholdsMs,
      sampledAt: now.toISOString(),
    };
  }

  async advanceRoomOnce(roomId: string, options: AdvanceRoomOptions = {}) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const lockResult = await this.roundMachineLockService.withRoomTickLock(
      roomId,
      async () => {
        try {
          return await this.advanceRoomOnceLocked(roomId, options);
        } catch (error) {
          if (error instanceof ConflictException) {
            this.logLeaderSkip(
              roomId,
              options,
              'DATABASE_LOCKED',
              'transition-conflict',
              error.message,
            );

            return this.toLeaderSkipResult(roomId, options, 'DATABASE_LOCKED');
          }

          throw error;
        }
      },
    );

    if (!lockResult.acquired) {
      this.logLeaderSkip(
        roomId,
        options,
        lockResult.reason,
        'tick-lock-not-acquired',
      );

      return this.toLeaderSkipResult(roomId, options, lockResult.reason);
    }

    return lockResult.result;
  }

  async advanceRoomMachineOnce(
    roomId: string,
    options: AdvanceRoomOptions = {},
  ) {
    await this.assertRoomCanRun(roomId);

    return this.runRoomTickImmediately(roomId, options, {
      skipIfStopped: false,
      priority: ROUND_MACHINE_TICK_PRIORITIES.CATCH_UP,
    });
  }

  private async advanceRoomOnceLocked(
    roomId: string,
    options: AdvanceRoomOptions = {},
  ) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const force = options.force === true;

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        code: true,
        status: true,
        roundDurationMs: true,
      },
    });

    if (!room) {
      throw new NotFoundException('Room not found.');
    }

    if (room.status !== RoomStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE rooms can be advanced.');
    }

    const now = new Date();

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: ACTIVE_ROUND_STATUSES },
      },
      orderBy: { roundNumber: 'desc' },
    });

    if (!currentRound) {
      const latestRound = await this.prisma.round.findFirst({
        where: { roomId },
        orderBy: { roundNumber: 'desc' },
      });

      if (latestRound?.status === RoundStatus.COMPLETED) {
        const completedAt = latestRound.completedAt;
        const cooldownEndsAt = completedAt
          ? completedAt.getTime() + MACHINE_TIMINGS_MS.cooldownPhase
          : now.getTime();

        if (!force && now.getTime() < cooldownEndsAt) {
          return {
            action: 'WAITING_FOR_COMPLETION_COOLDOWN',
            roomId,
            currentRound: this.roundsService.toRoundSnapshot(latestRound),
            msRemaining: cooldownEndsAt - now.getTime(),
            force,
          };
        }

        const startedRound =
          await this.roundsService.startOpenRoundForRoom(roomId);

        return {
          action: 'STARTED_NEXT_ROUND_AFTER_COMPLETION',
          roomId,
          previousRound: this.roundsService.toRoundSnapshot(latestRound),
          currentRound: startedRound,
          timings: {
            openPhase: room.roundDurationMs,
            ...MACHINE_TIMINGS_MS,
          },
          force,
        };
      }

      const startedRound =
        await this.roundsService.startOpenRoundForRoom(roomId);

      return {
        action: 'STARTED_OPEN_ROUND',
        roomId,
        currentRound: startedRound,
        timings: {
          openPhase: room.roundDurationMs,
          ...MACHINE_TIMINGS_MS,
        },
        force,
      };
    }

    if (currentRound.status === RoundStatus.OPEN) {
      if (!force && currentRound.locksAt && currentRound.locksAt > now) {
        return {
          action: 'WAITING_FOR_OPEN_TO_EXPIRE',
          roomId,
          currentRound: this.roundsService.toRoundSnapshot(currentRound),
          msRemaining: currentRound.locksAt.getTime() - now.getTime(),
          force,
        };
      }

      const entryCount = await this.prisma.entry.count({
        where: { roundId: currentRound.id },
      });

      if (entryCount === 0) {
        const cancelledAndStarted =
          await this.cancelEmptyOpenRoundAndStartNextForMachine(
            roomId,
            currentRound,
          );

        return {
          action: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
          roomId,
          cancelledRound: cancelledAndStarted.cancelledRound,
          currentRound: cancelledAndStarted.currentRound,
          refundSummary: cancelledAndStarted.refundSummary,
          force,
        };
      }

      if (entryCount === 1) {
        const cancelledAndStarted =
          await this.cancelOpenRoundAndStartNextForMachine(
            roomId,
            currentRound,
          );

        return {
          action: 'CANCELLED_SINGLE_PLAYER_ROUND_AND_STARTED_NEXT',
          roomId,
          cancelledRound: cancelledAndStarted.cancelledRound,
          currentRound: cancelledAndStarted.currentRound,
          refundSummary: cancelledAndStarted.refundSummary,
          force,
        };
      }

      const locked = await this.roundsService.lockCurrentRoundForRoom(roomId);

      return {
        action: 'LOCKED_ROUND',
        roomId,
        result: locked,
        force,
      };
    }

    if (currentRound.status === RoundStatus.LOCKED) {
      const entryCount = await this.prisma.entry.count({
        where: { roundId: currentRound.id },
      });

      if (entryCount === 0) {
        const cancelledAndStarted =
          await this.roundsService.cancelCurrentRoundAndStartNextForRoom(
            roomId,
          );

        return {
          action: 'CANCELLED_EMPTY_LOCKED_ROUND_AND_STARTED_NEXT',
          roomId,
          cancelledRound: cancelledAndStarted.cancelledRound,
          currentRound: cancelledAndStarted.currentRound,
          refundSummary: cancelledAndStarted.refundSummary,
          force,
        };
      }

      if (entryCount === 1) {
        const cancelledAndStarted =
          await this.roundsService.cancelCurrentRoundAndStartNextForRoom(
            roomId,
          );

        return {
          action: 'CANCELLED_SINGLE_PLAYER_LOCKED_ROUND_AND_STARTED_NEXT',
          roomId,
          cancelledRound: cancelledAndStarted.cancelledRound,
          currentRound: cancelledAndStarted.currentRound,
          refundSummary: cancelledAndStarted.refundSummary,
          force,
        };
      }

      if (
        !force &&
        currentRound.lockedAt &&
        now.getTime() <
          currentRound.lockedAt.getTime() + MACHINE_TIMINGS_MS.lockedPhase
      ) {
        return {
          action: 'WAITING_FOR_LOCKED_PHASE',
          roomId,
          currentRound: this.roundsService.toRoundSnapshot(currentRound),
          msRemaining:
            currentRound.lockedAt.getTime() +
            MACHINE_TIMINGS_MS.lockedPhase -
            now.getTime(),
          force,
        };
      }

      const drawn = await this.roundsService.drawCurrentRoundForRoom(roomId);

      return {
        action: 'DREW_ROUND',
        roomId,
        result: drawn,
        force,
      };
    }

    if (currentRound.status === RoundStatus.DRAWING) {
      if (
        !force &&
        currentRound.drawingAt &&
        now.getTime() <
          currentRound.drawingAt.getTime() + MACHINE_TIMINGS_MS.drawingPhase
      ) {
        return {
          action: 'WAITING_FOR_DRAWING_PHASE',
          roomId,
          currentRound: this.roundsService.toRoundSnapshot(currentRound),
          msRemaining:
            currentRound.drawingAt.getTime() +
            MACHINE_TIMINGS_MS.drawingPhase -
            now.getTime(),
          force,
        };
      }

      const spinning =
        await this.roundsService.startSpinningCurrentRoundForRoom(roomId);

      return {
        action: 'STARTED_SPINNING_ROUND',
        roomId,
        result: spinning,
        force,
      };
    }

    if (currentRound.status === RoundStatus.SPINNING) {
      if (
        !force &&
        currentRound.spinningAt &&
        now.getTime() <
          currentRound.spinningAt.getTime() + MACHINE_TIMINGS_MS.spinningPhase
      ) {
        return {
          action: 'WAITING_FOR_SPINNING_PHASE',
          roomId,
          currentRound: this.roundsService.toRoundSnapshot(currentRound),
          msRemaining:
            currentRound.spinningAt.getTime() +
            MACHINE_TIMINGS_MS.spinningPhase -
            now.getTime(),
          force,
        };
      }

      const settling =
        await this.roundsService.startSettlingCurrentRoundForRoom(roomId);

      return {
        action: 'STARTED_SETTLING_ROUND',
        roomId,
        result: settling,
        force,
      };
    }

    if (currentRound.status === RoundStatus.SETTLING) {
      if (
        !force &&
        currentRound.settlingAt &&
        now.getTime() <
          currentRound.settlingAt.getTime() + MACHINE_TIMINGS_MS.settlingPhase
      ) {
        return {
          action: 'WAITING_FOR_SETTLING_PHASE',
          roomId,
          currentRound: this.roundsService.toRoundSnapshot(currentRound),
          msRemaining:
            currentRound.settlingAt.getTime() +
            MACHINE_TIMINGS_MS.settlingPhase -
            now.getTime(),
          force,
        };
      }

      const settled =
        await this.roundsService.settleCurrentRoundForRoom(roomId);

      return {
        action: 'SETTLED_ROUND',
        roomId,
        result: settled,
        force,
      };
    }

    throw new BadRequestException(
      `Unsupported machine state: ${currentRound.status}`,
    );
  }

  private async autoStartPermanentActiveRooms() {
    const rooms = await this.prisma.room.findMany({
      where: {
        status: RoomStatus.ACTIVE,
        isPermanent: true,
      },
      select: {
        id: true,
        code: true,
      },
      orderBy: { code: 'asc' },
    });

    if (rooms.length === 0) {
      this.logger.log(
        'No ACTIVE permanent rooms found for machine auto-start.',
      );
      return;
    }

    await this.runWithConcurrency(
      rooms,
      AUTO_START_CONCURRENCY,
      async (room) => {
        try {
          await this.startRoomMachine(room.id);
          this.logger.log(`Auto-started round machine for room ${room.code}.`);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown auto-start error';

          this.logger.error(
            `Failed to auto-start round machine for room ${room.code}: ${message}`,
          );
        }
      },
    );
  }

  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    work: (item: T) => Promise<void>,
  ) {
    const workerCount = Math.min(Math.max(concurrency, 1), items.length);
    const workers = Array.from(
      { length: workerCount },
      async (_unused, workerIndex) => {
        for (
          let index = workerIndex;
          index < items.length;
          index += workerCount
        ) {
          await work(items[index]);
        }
      },
    );

    await Promise.allSettled(workers);
  }

  private async tickRoom(
    roomId: string,
    priority: number = ROUND_MACHINE_TICK_PRIORITIES.SCHEDULED,
  ) {
    this.timers.delete(roomId);

    await this.runRoomTick(
      roomId,
      { force: false },
      {
        skipIfStopped: true,
        priority,
      },
    );
  }

  private async runRoomTickImmediately(
    roomId: string,
    options: AdvanceRoomOptions = {},
    tickOptions: { skipIfStopped?: boolean; priority?: number } = {},
  ) {
    this.clearScheduledTick(roomId);

    return this.runRoomTick(roomId, options, {
      skipIfStopped: tickOptions.skipIfStopped ?? true,
      priority: tickOptions.priority ?? ROUND_MACHINE_TICK_PRIORITIES.CATCH_UP,
    });
  }

  private async runRoomTick(
    roomId: string,
    options: AdvanceRoomOptions,
    tickOptions: { skipIfStopped: boolean; priority: number },
  ) {
    const state = this.getOrCreateState(roomId);

    if (tickOptions.skipIfStopped && !state.isRunning) {
      return null;
    }

    const existingTick = this.ticksInFlight.get(roomId);

    if (existingTick) {
      this.raiseQueuedTickPriority(roomId, tickOptions.priority);
      return existingTick;
    }

    const tick = this.enqueueRoomTick(
      roomId,
      options,
      tickOptions.priority,
    ).finally(() => {
      if (this.ticksInFlight.get(roomId) === tick) {
        this.ticksInFlight.delete(roomId);
      }
    });

    this.ticksInFlight.set(roomId, tick);

    return tick;
  }

  private enqueueRoomTick(
    roomId: string,
    options: AdvanceRoomOptions,
    priority: number,
  ) {
    const tick = new Promise((resolve, reject) => {
      const queuedTick: QueuedRoomTick = {
        roomId,
        options,
        priority,
        sequence: this.tickQueueSequence++,
        enqueuedAt: Date.now(),
        resolve,
        reject,
      };

      this.pendingTickQueue.push(queuedTick);
      this.queuedTicksByRoom.set(roomId, queuedTick);
      this.drainTickQueue();
    });

    return tick;
  }

  private raiseQueuedTickPriority(roomId: string, priority: number) {
    const queuedTick = this.queuedTicksByRoom.get(roomId);

    if (!queuedTick || queuedTick.priority <= priority) {
      return;
    }

    queuedTick.priority = priority;
  }

  private drainTickQueue() {
    while (this.pendingTickQueue.length > 0) {
      this.pendingTickQueue.sort(
        (a, b) => a.priority - b.priority || a.sequence - b.sequence,
      );

      const nextTick = this.pendingTickQueue[0];
      const canUseNormalSlot =
        this.activeTickExecutions < ROUND_MACHINE_NORMAL_TICK_CONCURRENCY;
      const canUseUrgentSlot =
        nextTick.priority <= ROUND_MACHINE_TICK_PRIORITIES.CATCH_UP &&
        this.activeTickExecutions < ROUND_MACHINE_URGENT_TICK_CONCURRENCY;

      if (!canUseNormalSlot && !canUseUrgentSlot) {
        return;
      }

      const queuedTick = this.pendingTickQueue.shift();

      if (!queuedTick) {
        return;
      }

      this.queuedTicksByRoom.delete(queuedTick.roomId);
      this.activeTickExecutions += 1;
      this.logTickQueueWaitIfSlow(queuedTick);

      void this.executeRoomTick(queuedTick.roomId, queuedTick.options)
        .then(queuedTick.resolve, queuedTick.reject)
        .finally(() => {
          this.activeTickExecutions -= 1;
          this.drainTickQueue();
        });
    }
  }

  private logTickQueueWaitIfSlow(queuedTick: QueuedRoomTick) {
    const waitMs = Date.now() - queuedTick.enqueuedAt;

    if (waitMs < ROUND_MACHINE_TICK_QUEUE_WARN_THRESHOLD_MS) {
      return;
    }

    this.logger.warn(
      `[round-machine-queue:${queuedTick.roomId}] wait=${waitMs}ms priority=${queuedTick.priority} queued=${this.pendingTickQueue.length} active=${this.activeTickExecutions} normalConcurrency=${ROUND_MACHINE_NORMAL_TICK_CONCURRENCY} urgentConcurrency=${ROUND_MACHINE_URGENT_TICK_CONCURRENCY}`,
    );
  }

  private async executeRoomTick(roomId: string, options: AdvanceRoomOptions) {
    return this.executeRoomTickWithAdvance(roomId, options, () =>
      this.advanceRoomOnce(roomId, options),
    );
  }

  private async executeRoomTickWithAdvance(
    roomId: string,
    options: AdvanceRoomOptions,
    advance: () => Promise<any>,
  ) {
    const state = this.getOrCreateState(roomId);

    try {
      state.tickCount += 1;
      state.lastTickAt = new Date();
      state.lastError = null;

      const result = await advance();

      state.lastAction = result.action;
      this.states.set(roomId, state);

      if (state.isRunning) {
        const nextDelayMs = this.getNextDelayMs(result);
        const nextPriority = this.getNextTickPriority(result);
        this.scheduleNextTick(roomId, nextDelayMs, nextPriority);
      } else {
        state.nextTickAt = null;
        this.states.set(roomId, state);
      }

      /**
       * Important performance fix:
       *
       * Do not block the round-machine scheduler on socket broadcasting.
       * broadcastMachineResult may trigger live-state generation, which can be
       * slow under Supabase pooler pressure. The state transition is already
       * committed before this point, so broadcasting can safely happen in the
       * background.
       */
      this.broadcastMachineResultInBackground(roomId, result);

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown machine error';

      state.lastError = message;
      state.lastTickAt = state.lastTickAt ?? new Date();
      this.states.set(roomId, state);

      this.logger.error(
        `[round-machine-tick-failed:${roomId}] action=TICK_FAILED message=${message} force=${options.force === true} isRunning=${state.isRunning} tickCount=${state.tickCount}`,
      );

      if (state.isRunning) {
        this.scheduleNextTick(roomId, 5_000);
      } else {
        state.nextTickAt = null;
        this.states.set(roomId, state);
      }

      return {
        action: 'TICK_FAILED',
        roomId,
        message,
        force: options.force === true,
      };
    }
  }

  broadcastMachineResultInBackground(roomId: string, result: any) {
    if (!this.shouldBroadcastMachineResult(result)) {
      return;
    }

    void this.roomGateway
      .broadcastMachineResult(roomId, result)
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unknown broadcast error';

        this.logger.warn(
          `Room machine broadcast failed for ${roomId} after ${result?.action ?? 'UNKNOWN_ACTION'}: ${message}`,
        );
      });
  }

  private shouldBroadcastMachineResult(result: any) {
    const action = result?.action;

    if (!action || typeof action !== 'string') {
      return false;
    }

    // Waiting actions are internal scheduler states and should not spam clients.
    const silentActions = new Set([
      'WAITING_FOR_OPEN_TO_EXPIRE',
      'WAITING_FOR_LOCKED_PHASE',
      'WAITING_FOR_DRAWING_PHASE',
      'WAITING_FOR_SPINNING_PHASE',
      'WAITING_FOR_SETTLING_PHASE',
      'WAITING_FOR_COMPLETION_COOLDOWN',
      'SKIPPED_NOT_LEADER',
    ]);

    if (silentActions.has(action)) {
      return false;
    }

    // Everything else is a visible state change or an error/convergence state.
    // Emitting canonical round:state keeps the browser synchronized without polling.
    return true;
  }

  private scheduleNextTick(
    roomId: string,
    delayMs: number,
    priority: number = ROUND_MACHINE_TICK_PRIORITIES.SCHEDULED,
  ) {
    const state = this.getOrCreateState(roomId);

    if (!state.isRunning) {
      return;
    }

    const existingTimer = this.timers.get(roomId);

    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(roomId);
    }

    const safeDelayMs = this.clampDelay(delayMs);
    state.nextTickAt = new Date(Date.now() + safeDelayMs);
    this.states.set(roomId, state);

    const timer = setTimeout(() => {
      void this.tickRoom(roomId, priority);
    }, safeDelayMs);

    this.timers.set(roomId, timer);
  }

  private clearScheduledTick(roomId: string) {
    const existingTimer = this.timers.get(roomId);

    if (!existingTimer) {
      return;
    }

    clearTimeout(existingTimer);
    this.timers.delete(roomId);
  }

  private getNextDelayMs(result: any): number {
    if (typeof result?.msRemaining === 'number') {
      return result.msRemaining;
    }

    if (result?.action === 'STARTED_OPEN_ROUND') {
      return this.delayUntilRoundLocksAt(result.currentRound);
    }

    if (result?.action === 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT') {
      return this.delayUntilRoundLocksAt(result.currentRound);
    }

    if (result?.action === 'CANCELLED_SINGLE_PLAYER_ROUND_AND_STARTED_NEXT') {
      return this.delayUntilRoundLocksAt(result.currentRound);
    }

    if (result?.action === 'CANCELLED_EMPTY_LOCKED_ROUND_AND_STARTED_NEXT') {
      return this.delayUntilRoundLocksAt(result.currentRound);
    }

    if (
      result?.action === 'CANCELLED_SINGLE_PLAYER_LOCKED_ROUND_AND_STARTED_NEXT'
    ) {
      return this.delayUntilRoundLocksAt(result.currentRound);
    }

    if (result?.action === 'STARTED_NEXT_ROUND_AFTER_COMPLETION') {
      return this.delayUntilRoundLocksAt(result.currentRound);
    }

    if (result?.action === 'LOCKED_ROUND') {
      return MACHINE_TIMINGS_MS.lockedPhase;
    }

    if (result?.action === 'DREW_ROUND') {
      return MACHINE_TIMINGS_MS.drawingPhase;
    }

    if (result?.action === 'STARTED_SPINNING_ROUND') {
      return MACHINE_TIMINGS_MS.spinningPhase;
    }

    if (result?.action === 'STARTED_SETTLING_ROUND') {
      return MACHINE_TIMINGS_MS.settlingPhase;
    }

    if (
      result?.action === 'SETTLED_ROUND' ||
      result?.action === 'RESUMED_SETTLEMENT'
    ) {
      return MACHINE_TIMINGS_MS.cooldownPhase;
    }

    if (result?.action === 'SKIPPED_NOT_LEADER') {
      return 1_000;
    }

    return 1_000;
  }

  private getNextTickPriority(result: any): number {
    const action = result?.action;

    if (
      action === 'SETTLED_ROUND' ||
      action === 'RESUMED_SETTLEMENT' ||
      action === 'WAITING_FOR_COMPLETION_COOLDOWN'
    ) {
      return ROUND_MACHINE_TICK_PRIORITIES.CATCH_UP;
    }

    return ROUND_MACHINE_TICK_PRIORITIES.SCHEDULED;
  }

  private delayUntilRoundLocksAt(round: { locksAt?: string | null } | null) {
    if (!round?.locksAt) {
      return 1_000;
    }

    return Math.max(0, new Date(round.locksAt).getTime() - Date.now());
  }

  private clampDelay(delayMs: number) {
    if (!Number.isFinite(delayMs)) {
      return 1_000;
    }

    return Math.max(0, Math.min(delayMs, 60_000));
  }

  private cancelOpenRoundAndStartNextForMachine(
    roomId: string,
    currentRound: { id: string; locksAt: Date | null },
  ) {
    const isExpired =
      currentRound.locksAt !== null &&
      currentRound.locksAt.getTime() <= Date.now();

    if (isExpired) {
      return this.roundsService.cancelExpiredOpenRoundAndStartNextForRoom(
        roomId,
        currentRound.id,
      );
    }

    return this.roundsService.cancelCurrentRoundAndStartNextForRoom(roomId);
  }

  private async cancelEmptyOpenRoundAndStartNextForMachine(
    roomId: string,
    currentRound: { id: string; locksAt: Date | null },
  ) {
    const isExpired =
      currentRound.locksAt !== null &&
      currentRound.locksAt.getTime() <= Date.now();

    if (isExpired) {
      const fastResult =
        await this.roundsService.cancelExpiredEmptyOpenRoundAndStartNextForRoom(
          roomId,
          currentRound.id,
        );

      if (fastResult) {
        return fastResult;
      }
    }

    return this.cancelOpenRoundAndStartNextForMachine(roomId, currentRound);
  }

  private getVisibleStatusRound<
    T extends {
      status: RoundStatus;
      completedAt: Date | null;
      cancelledAt: Date | null;
    },
  >(activeRound: T | null, latestRound: T | null, now: Date) {
    if (activeRound) {
      return activeRound;
    }

    if (!latestRound) {
      return null;
    }

    if (
      latestRound.status === RoundStatus.COMPLETED &&
      latestRound.completedAt &&
      now.getTime() <
        latestRound.completedAt.getTime() + MACHINE_TIMINGS_MS.cooldownPhase
    ) {
      return latestRound;
    }

    if (
      latestRound.status === RoundStatus.CANCELLED &&
      latestRound.cancelledAt &&
      now.getTime() <
        latestRound.cancelledAt.getTime() + MACHINE_TIMINGS_MS.settlingPhase
    ) {
      return latestRound;
    }

    return null;
  }

  private getRuntimeHealthSnapshot() {
    const states = Array.from(this.states.values());
    const runningRooms = states.filter((state) => state.isRunning).length;
    const lastTickAt = this.getLatestDate(
      states
        .map((state) => state.lastTickAt)
        .filter((date): date is Date => date !== null),
    );
    const nextTickAt = this.getEarliestDate(
      states
        .map((state) => state.nextTickAt)
        .filter((date): date is Date => date !== null),
    );

    return {
      trackedRooms: states.length,
      runningRooms,
      stoppedRooms: states.length - runningRooms,
      timers: this.timers.size,
      ticksInFlight: this.ticksInFlight.size,
      catchUpsInFlight: this.catchUpsInFlight.size,
      queuedTicks: this.pendingTickQueue.length,
      queuedRooms: this.queuedTicksByRoom.size,
      activeTickExecutions: this.activeTickExecutions,
      roomsWithLastError: states.filter((state) => state.lastError !== null)
        .length,
      lastTickAt: lastTickAt?.toISOString() ?? null,
      nextTickAt: nextTickAt?.toISOString() ?? null,
    };
  }

  private buildStaleRoundDiagnostics(
    rooms: RoundMachineDiagnosticsRoom[],
    now: Date,
  ) {
    const counts = {
      completedPastCooldown: 0,
      activePermanentRoomsWithoutCurrentActiveRound: 0,
      activePermanentRoomsStaleWithoutCurrentRound: 0,
      staleCompletedOrCurrent: 0,
      staleLocked: 0,
      staleDrawing: 0,
      staleSpinning: 0,
      staleSettling: 0,
    };
    const warnings: RoundMachineDiagnosticWarning[] = [];

    for (const room of rooms) {
      const latestRound = room.rounds[0] ?? null;
      const state = this.states.get(room.id);
      const warningBase = {
        roomId: room.id,
        roomCode: room.code,
        machineRunning: state?.isRunning === true,
        lastTickAt: state?.lastTickAt?.toISOString() ?? null,
      };

      if (!latestRound) {
        counts.activePermanentRoomsWithoutCurrentActiveRound += 1;
        counts.activePermanentRoomsStaleWithoutCurrentRound += 1;
        warnings.push({
          ...warningBase,
          reason: 'NO_ROUNDS_FOR_ACTIVE_PERMANENT_ROOM',
          roundId: null,
          roundNumber: null,
          status: null,
          ageMs: null,
          thresholdMs: null,
        });
        continue;
      }

      const hasCurrentActiveRound = ACTIVE_ROUND_STATUSES.includes(
        latestRound.status,
      );

      if (!hasCurrentActiveRound) {
        counts.activePermanentRoomsWithoutCurrentActiveRound += 1;
      }

      if (latestRound.status === RoundStatus.COMPLETED) {
        const ageMs = this.ageMs(latestRound.completedAt, now);
        const thresholdMs = MACHINE_TIMINGS_MS.cooldownPhase;

        if (ageMs !== null && ageMs >= thresholdMs) {
          counts.completedPastCooldown += 1;
          counts.activePermanentRoomsStaleWithoutCurrentRound += 1;
          warnings.push({
            ...warningBase,
            reason: 'COMPLETED_PAST_COOLDOWN',
            roundId: latestRound.id,
            roundNumber: latestRound.roundNumber,
            status: latestRound.status,
            ageMs,
            thresholdMs,
          });
        }
      } else if (!hasCurrentActiveRound) {
        counts.activePermanentRoomsStaleWithoutCurrentRound += 1;
      }

      if (!hasCurrentActiveRound) {
        const ageMs = this.ageMs(
          latestRound.completedAt ??
            latestRound.cancelledAt ??
            latestRound.updatedAt,
          now,
        );
        const isExpectedCompletedReveal =
          latestRound.status === RoundStatus.COMPLETED &&
          ageMs !== null &&
          ageMs < MACHINE_TIMINGS_MS.cooldownPhase;

        if (!isExpectedCompletedReveal) {
          warnings.push({
            ...warningBase,
            reason: 'NO_CURRENT_ACTIVE_ROUND',
            roundId: latestRound.id,
            roundNumber: latestRound.roundNumber,
            status: latestRound.status,
            ageMs,
            thresholdMs:
              latestRound.status === RoundStatus.COMPLETED
                ? MACHINE_TIMINGS_MS.cooldownPhase
                : null,
          });
        }
      }

      const stalePhaseThresholdMs = this.getStalePhaseThresholdMs(
        latestRound.status,
      );

      if (stalePhaseThresholdMs === null) {
        continue;
      }

      const ageMs = this.ageMs(this.getPhaseStartedAt(latestRound), now);

      if (ageMs === null || ageMs < stalePhaseThresholdMs) {
        continue;
      }

      if (latestRound.status === RoundStatus.LOCKED) {
        counts.staleLocked += 1;
      } else if (latestRound.status === RoundStatus.DRAWING) {
        counts.staleDrawing += 1;
      } else if (latestRound.status === RoundStatus.SPINNING) {
        counts.staleSpinning += 1;
      } else if (latestRound.status === RoundStatus.SETTLING) {
        counts.staleSettling += 1;
      }

      warnings.push({
        ...warningBase,
        reason: `STALE_${latestRound.status}_ROUND` as
          | 'STALE_LOCKED_ROUND'
          | 'STALE_DRAWING_ROUND'
          | 'STALE_SPINNING_ROUND'
          | 'STALE_SETTLING_ROUND',
        roundId: latestRound.id,
        roundNumber: latestRound.roundNumber,
        status: latestRound.status,
        ageMs,
        thresholdMs: stalePhaseThresholdMs,
      });
    }

    counts.staleCompletedOrCurrent =
      counts.activePermanentRoomsStaleWithoutCurrentRound +
      counts.staleLocked +
      counts.staleDrawing +
      counts.staleSpinning +
      counts.staleSettling;

    return {
      counts: {
        ...counts,
        warnings: warnings.length,
      },
      thresholdsMs: {
        completedCooldown: MACHINE_TIMINGS_MS.cooldownPhase,
        stalePhaseBuffer: ROUND_MACHINE_STALE_PHASE_BUFFER_MS,
        locked:
          MACHINE_TIMINGS_MS.lockedPhase + ROUND_MACHINE_STALE_PHASE_BUFFER_MS,
        drawing:
          MACHINE_TIMINGS_MS.drawingPhase + ROUND_MACHINE_STALE_PHASE_BUFFER_MS,
        spinning:
          MACHINE_TIMINGS_MS.spinningPhase +
          ROUND_MACHINE_STALE_PHASE_BUFFER_MS,
        settling:
          MACHINE_TIMINGS_MS.settlingPhase +
          ROUND_MACHINE_STALE_PHASE_BUFFER_MS,
      },
      warnings,
    };
  }

  private logStaleRoundDiagnostics(
    warnings: RoundMachineDiagnosticWarning[],
    now: Date,
  ) {
    for (const warning of warnings) {
      const logKey = `${warning.reason}:${warning.roomId}:${warning.roundId ?? 'none'}`;
      const previousLogAt = this.diagnosticWarningLastLoggedAt.get(logKey) ?? 0;

      if (now.getTime() - previousLogAt < ROUND_MACHINE_STALE_LOG_THROTTLE_MS) {
        continue;
      }

      this.diagnosticWarningLastLoggedAt.set(logKey, now.getTime());
      this.logger.warn(
        `[round-machine-stuck:${warning.roomId}] reason=${warning.reason} roomCode=${warning.roomCode} roundId=${warning.roundId ?? 'none'} roundNumber=${warning.roundNumber ?? 'none'} status=${warning.status ?? 'none'} ageMs=${warning.ageMs ?? 'unknown'} thresholdMs=${warning.thresholdMs ?? 'unknown'} machineRunning=${warning.machineRunning} lastTickAt=${warning.lastTickAt ?? 'none'}`,
      );
    }
  }

  private getStalePhaseThresholdMs(status: RoundStatus) {
    if (status === RoundStatus.LOCKED) {
      return (
        MACHINE_TIMINGS_MS.lockedPhase + ROUND_MACHINE_STALE_PHASE_BUFFER_MS
      );
    }

    if (status === RoundStatus.DRAWING) {
      return (
        MACHINE_TIMINGS_MS.drawingPhase + ROUND_MACHINE_STALE_PHASE_BUFFER_MS
      );
    }

    if (status === RoundStatus.SPINNING) {
      return (
        MACHINE_TIMINGS_MS.spinningPhase + ROUND_MACHINE_STALE_PHASE_BUFFER_MS
      );
    }

    if (status === RoundStatus.SETTLING) {
      return (
        MACHINE_TIMINGS_MS.settlingPhase + ROUND_MACHINE_STALE_PHASE_BUFFER_MS
      );
    }

    return null;
  }

  private getPhaseStartedAt(round: RoundMachineDiagnosticsRoom['rounds'][0]) {
    if (round.status === RoundStatus.LOCKED) {
      return round.lockedAt;
    }

    if (round.status === RoundStatus.DRAWING) {
      return round.drawingAt;
    }

    if (round.status === RoundStatus.SPINNING) {
      return round.spinningAt;
    }

    if (round.status === RoundStatus.SETTLING) {
      return round.settlingAt;
    }

    return null;
  }

  private ageMs(startedAt: Date | null | undefined, now: Date) {
    if (!startedAt) {
      return null;
    }

    return Math.max(0, now.getTime() - startedAt.getTime());
  }

  private getLatestDate(dates: Date[]) {
    return dates.reduce<Date | null>((latest, date) => {
      if (!latest || date > latest) {
        return date;
      }

      return latest;
    }, null);
  }

  private getEarliestDate(dates: Date[]) {
    return dates.reduce<Date | null>((earliest, date) => {
      if (!earliest || date < earliest) {
        return date;
      }

      return earliest;
    }, null);
  }

  private logLeaderSkip(
    roomId: string,
    options: AdvanceRoomOptions,
    reason: 'PROCESS_LOCKED' | 'DATABASE_LOCKED' | 'REDIS_LOCKED',
    source: string,
    message?: string,
  ) {
    this.logger.warn(
      `[round-machine-skip:${roomId}] action=SKIPPED_NOT_LEADER reason=${reason} source=${source} force=${options.force === true} message=${message ?? 'none'}`,
    );
  }

  private getInstanceId() {
    return (
      process.env.KINGSPIN_INSTANCE_ID ??
      process.env.COOLIFY_CONTAINER_NAME ??
      process.env.HOSTNAME ??
      process.env.FLY_ALLOC_ID ??
      process.env.RENDER_INSTANCE_ID ??
      process.env.DYNO ??
      null
    );
  }

  private toLeaderSkipResult(
    roomId: string,
    options: AdvanceRoomOptions,
    reason: 'PROCESS_LOCKED' | 'DATABASE_LOCKED' | 'REDIS_LOCKED',
  ) {
    const message =
      reason === 'PROCESS_LOCKED'
        ? 'This process is already advancing this room.'
        : reason === 'REDIS_LOCKED'
          ? 'Another API instance is advancing this room.'
          : 'Another process is advancing this room.';

    return {
      action: 'SKIPPED_NOT_LEADER',
      roomId,
      message,
      force: options.force === true,
    };
  }

  private getOrCreateState(roomId: string): MachineRuntimeState {
    const existing = this.states.get(roomId);

    if (existing) {
      return existing;
    }

    const state: MachineRuntimeState = {
      roomId,
      isRunning: false,
      tickCount: 0,
      lastAction: null,
      lastError: null,
      lastTickAt: null,
      nextTickAt: null,
    };

    this.states.set(roomId, state);

    return state;
  }

  private async assertRoomCanRun(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!room) {
      throw new NotFoundException('Room not found.');
    }

    if (room.status !== RoomStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE rooms can run the machine.');
    }
  }
}

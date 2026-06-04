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

@Injectable()
export class RoundMachineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoundMachineService.name);

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly states = new Map<string, MachineRuntimeState>();
  private readonly ticksInFlight = new Map<string, Promise<any>>();
  private readonly catchUpsInFlight = new Map<string, Promise<any>>();
  private readonly queuedTicksByRoom = new Map<string, QueuedRoomTick>();
  private readonly pendingTickQueue: QueuedRoomTick[] = [];
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
            return this.toLeaderSkipResult(roomId, options, 'DATABASE_LOCKED');
          }

          throw error;
        }
      },
    );

    if (!lockResult.acquired) {
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

      this.logger.error(`Room machine tick failed for ${roomId}: ${message}`);

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

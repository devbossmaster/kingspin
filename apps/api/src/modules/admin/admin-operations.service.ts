import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  AdminAuditAction,
  DepositStatus,
  Prisma,
  RiskEventSeverity,
  RiskEventStatus,
  RiskEventType,
  Role,
  RoundStatus,
  WithdrawalStatus,
} from "@kingspin/db";
import { getApiEnv } from "../../config/api-env";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { FraudService } from "../fraud/fraud.service";
import { RedisService } from "../redis/redis.service";
import { RoundMachineService } from "../rounds/round-machine.service";

type ListQuery = {
  page?: string | number;
  pageSize?: string | number;
  q?: string;
  status?: string;
  from?: string;
  to?: string;
};

const ACTIVE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly fraudService: FraudService,
    private readonly redisService: RedisService,
    private readonly roundMachineService: RoundMachineService,
  ) {}

  async getDashboard() {
    const [summary, recent, system] = await Promise.all([
      this.getDashboardSummary(),
      this.getDashboardRecentActivity().catch(() => ({
        deposits: [],
        withdrawals: [],
        entries: [],
        rounds: [],
        audit: [],
        risk: [],
        warning: "Recent activity unavailable.",
      })),
      this.getSystemHealth().catch(() =>
        this.degradedSystemHealth("System health snapshot unavailable."),
      ),
    ]);

    return {
      ...summary,
      system,
      recent,
    };
  }

  async getDashboardSummary() {
    const today = this.startOfToday();
    const [
      activeRooms,
      openRounds,
      spinningRounds,
      completedRoundsToday,
      entriesToday,
      openPool,
      pendingDeposits,
      creditedDepositsToday,
      creditedDepositAmountToday,
      failedDepositAttemptsToday,
      pendingWithdrawals,
      completedWithdrawalsToday,
      completedWithdrawalAmountToday,
      totalUsers,
      newUsersToday,
      activePlayers,
      suspendedUsers,
      openRiskEvents,
      highSeverityRiskEvents,
      rapidEntryBlocksToday,
      duplicateReceiptAttemptsToday,
    ] = await Promise.all([
      this.prisma.room.count({ where: { status: "ACTIVE" } }),
      this.prisma.round.count({ where: { status: RoundStatus.OPEN } }),
      this.prisma.round.count({
        where: {
          status: {
            in: [
              RoundStatus.LOCKED,
              RoundStatus.DRAWING,
              RoundStatus.SPINNING,
              RoundStatus.SETTLING,
            ],
          },
        },
      }),
      this.prisma.round.count({
        where: { status: RoundStatus.COMPLETED, completedAt: { gte: today } },
      }),
      this.prisma.entry.count({ where: { createdAt: { gte: today } } }),
      this.prisma.entry.aggregate({
        where: { round: { status: RoundStatus.OPEN } },
        _sum: { amount: true },
      }),
      this.prisma.depositIntent.count({
        where: {
          status: {
            in: [
              DepositStatus.PENDING,
              DepositStatus.VERIFYING,
              DepositStatus.NEEDS_MANUAL_REVIEW,
            ],
          },
        },
      }),
      this.prisma.depositIntent.count({
        where: { status: DepositStatus.CREDITED, creditedAt: { gte: today } },
      }),
      this.prisma.depositIntent.aggregate({
        where: { status: DepositStatus.CREDITED, creditedAt: { gte: today } },
        _sum: { expectedAmount: true },
      }),
      this.prisma.paymentVerificationAttempt.count({
        where: {
          createdAt: { gte: today },
          status: {
            in: [
              "REJECTED",
              "FETCH_FAILED",
              "PARSE_FAILED",
              "NEEDS_MANUAL_REVIEW",
            ],
          },
        },
      }),
      this.prisma.withdrawal.count({
        where: {
          status: {
            in: [
              WithdrawalStatus.PENDING_REVIEW,
              WithdrawalStatus.APPROVED,
              WithdrawalStatus.PROCESSING,
            ],
          },
        },
      }),
      this.prisma.withdrawal.count({
        where: {
          status: {
            in: [WithdrawalStatus.PAID, WithdrawalStatus.COMPLETED],
          },
          paidAt: { gte: today },
        },
      }),
      this.prisma.withdrawal.aggregate({
        where: {
          status: {
            in: [WithdrawalStatus.PAID, WithdrawalStatus.COMPLETED],
          },
          paidAt: { gte: today },
        },
        _sum: { amount: true },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: today } } }),
      this.prisma.entry.findMany({
        where: { createdAt: { gte: today } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      this.prisma.user.count({ where: { bannedAt: { not: null } } }),
      this.prisma.riskEvent.count({ where: { status: RiskEventStatus.OPEN } }),
      this.prisma.riskEvent.count({
        where: {
          status: RiskEventStatus.OPEN,
          severity: {
            in: [RiskEventSeverity.HIGH, RiskEventSeverity.CRITICAL],
          },
        },
      }),
      this.prisma.riskEvent.count({
        where: {
          type: RiskEventType.ENTRY_RATE_LIMIT_HIT,
          createdAt: { gte: today },
        },
      }),
      this.prisma.riskEvent.count({
        where: {
          type: RiskEventType.DEPOSIT_WEBHOOK_MISMATCH,
          createdAt: { gte: today },
        },
      }),
    ]);

    return {
      game: {
        activeRooms,
        openRounds,
        spinningRounds,
        completedRoundsToday,
        entriesToday,
        openPoolAmount: (openPool._sum.amount ?? 0n).toString(),
      },
      payments: {
        pendingDeposits,
        creditedDepositsToday,
        creditedDepositAmountToday:
          creditedDepositAmountToday._sum.expectedAmount?.toString() ?? "0",
        failedDepositAttemptsToday,
        pendingWithdrawals,
        completedWithdrawalsToday,
        completedWithdrawalAmountToday: (
          completedWithdrawalAmountToday._sum.amount ?? 0n
        ).toString(),
      },
      users: {
        totalUsers,
        newUsersToday,
        activePlayersToday: activePlayers.length,
        suspendedUsers,
      },
      risk: {
        openRiskEvents,
        highSeverityRiskEvents,
        rapidEntryBlocksToday,
        duplicateReceiptAttemptsToday,
      },
    };
  }

  async getDashboardRecentActivity() {
    const warnings: Record<string, string> = {};
    const safePanel = async <T, TResult>(
      key: string,
      query: Promise<T[]>,
      map: (items: T[]) => TResult[],
    ) => {
      try {
        return map(await query);
      } catch {
        warnings[key] = `${key.replaceAll("_", " ")} unavailable.`;
        return [];
      }
    };
    const [entries, deposits, withdrawals, rounds, audit, risk] =
      await Promise.all([
        safePanel(
          "entries",
          this.prisma.entry.findMany({
            take: 6,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              amount: true,
              createdAt: true,
              user: { select: { username: true, displayUsername: true } },
              round: {
                select: {
                  roundNumber: true,
                  room: { select: { code: true } },
                },
              },
            },
          }),
          (recentEntries) =>
            recentEntries.map((entry) => ({
              id: entry.id,
              player: this.userLabel(entry.user),
              room: entry.round.room.code,
              roundNumber: entry.round.roundNumber,
              amount: entry.amount.toString(),
              createdAt: entry.createdAt.toISOString(),
            })),
        ),
        safePanel(
          "deposits",
          this.prisma.depositIntent.findMany({
            take: 6,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              expectedAmount: true,
              currency: true,
              status: true,
              createdAt: true,
              user: { select: { username: true, displayUsername: true } },
            },
          }),
          (recentDeposits) =>
            recentDeposits.map((deposit) => ({
              id: deposit.id,
              player: this.userLabel(deposit.user),
              amount: deposit.expectedAmount.toString(),
              currency: deposit.currency,
              status: deposit.status,
              createdAt: deposit.createdAt.toISOString(),
            })),
        ),
        safePanel(
          "withdrawals",
          this.prisma.withdrawal.findMany({
            take: 6,
            orderBy: { requestedAt: "desc" },
            select: {
              id: true,
              amount: true,
              currency: true,
              status: true,
              requestedAt: true,
              user: { select: { username: true, displayUsername: true } },
            },
          }),
          (recentWithdrawals) =>
            recentWithdrawals.map((withdrawal) => ({
              id: withdrawal.id,
              player: this.userLabel(withdrawal.user),
              amount: withdrawal.amount.toString(),
              currency: withdrawal.currency,
              status: withdrawal.status,
              createdAt: withdrawal.requestedAt.toISOString(),
            })),
        ),
        safePanel(
          "rounds",
          this.prisma.round.findMany({
            where: { status: RoundStatus.COMPLETED },
            take: 6,
            orderBy: { completedAt: "desc" },
            select: {
              id: true,
              roundNumber: true,
              payoutAmount: true,
              completedAt: true,
              room: { select: { code: true } },
            },
          }),
          (recentRounds) =>
            recentRounds.map((round) => ({
              id: round.id,
              room: round.room.code,
              roundNumber: round.roundNumber,
              payoutAmount: round.payoutAmount.toString(),
              completedAt: round.completedAt?.toISOString() ?? null,
            })),
        ),
        safePanel(
          "audit",
          this.prisma.adminAuditLog.findMany({
            take: 6,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              action: true,
              targetType: true,
              targetId: true,
              createdAt: true,
              actor: { select: { username: true, displayUsername: true } },
            },
          }),
          (recentAudit) =>
            recentAudit.map((log) => ({
              id: log.id,
              actor: log.actor ? this.userLabel(log.actor) : "System",
              action: log.action,
              targetType: log.targetType,
              targetId: log.targetId,
              createdAt: log.createdAt.toISOString(),
            })),
        ),
        safePanel(
          "risk",
          this.prisma.riskEvent.findMany({
            where: { status: RiskEventStatus.OPEN },
            take: 6,
            orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              type: true,
              severity: true,
              status: true,
              createdAt: true,
              user: { select: { username: true, displayUsername: true } },
            },
          }),
          (recentRisk) =>
            recentRisk.map((event) => ({
              id: event.id,
              player: event.user ? this.userLabel(event.user) : null,
              type: event.type,
              severity: event.severity,
              status: event.status,
              createdAt: event.createdAt.toISOString(),
            })),
        ),
      ]);

    return {
      entries,
      deposits,
      withdrawals,
      rounds,
      audit,
      risk,
      ...(Object.keys(warnings).length > 0 ? { warnings } : {}),
    };
  }

  async listUsers(query: ListQuery) {
    const page = this.parsePage(query);
    const search = query.q?.trim();
    const status = query.status?.trim().toUpperCase();
    const where: Prisma.UserWhereInput = {
      ...(search
        ? {
            OR: [
              { username: { contains: search, mode: "insensitive" } },
              { displayUsername: { contains: search, mode: "insensitive" } },
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { id: search },
            ],
          }
        : {}),
      ...(status === "SUSPENDED"
        ? { bannedAt: { not: null } }
        : status === "ACTIVE"
          ? { bannedAt: null }
          : {}),
      createdAt: this.dateRange(query),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: page.skip,
        take: page.pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          username: true,
          displayUsername: true,
          fullName: true,
          role: true,
          bannedAt: true,
          createdAt: true,
          walletAccounts: {
            where: { type: "MAIN" },
            select: { balanceSnapshot: true },
            take: 1,
          },
          _count: {
            select: {
              entries: true,
              deposits: true,
              depositIntents: true,
              withdrawals: true,
            },
          },
          riskEvents: {
            where: { status: RiskEventStatus.OPEN },
            select: { severity: true },
          },
        },
      }),
    ]);
    const userIds = users.map((user) => user.id);
    const [depositTotals, depositIntentTotals, withdrawalTotals] =
      userIds.length > 0
        ? await Promise.all([
            this.prisma.deposit.groupBy({
              by: ["userId"],
              where: { userId: { in: userIds } },
              _sum: { amount: true },
            }),
            this.prisma.depositIntent.groupBy({
              by: ["userId"],
              where: { userId: { in: userIds } },
              _sum: { expectedAmount: true },
            }),
            this.prisma.withdrawal.groupBy({
              by: ["userId"],
              where: { userId: { in: userIds } },
              _sum: { amount: true },
            }),
          ])
        : [[], [], []];
    const depositByUser = new Map(
      depositTotals.map((item) => [item.userId, item._sum.amount ?? 0n]),
    );
    const intentByUser = new Map(
      depositIntentTotals.map((item) => [
        item.userId,
        item._sum.expectedAmount
          ? BigInt(item._sum.expectedAmount.toFixed(0))
          : 0n,
      ]),
    );
    const withdrawalByUser = new Map(
      withdrawalTotals.map((item) => [
        item.userId,
        item._sum.amount ?? 0n,
      ]),
    );

    return this.pageResult(
      users.map((user) => ({
        id: user.id,
        username: user.displayUsername ?? user.username,
        fullName: user.fullName,
        email: this.maskEmail(user.email),
        role: user.role,
        accountStatus: user.bannedAt ? "SUSPENDED" : "ACTIVE",
        joinedAt: user.createdAt.toISOString(),
        balance: (user.walletAccounts[0]?.balanceSnapshot ?? 0n).toString(),
        entriesCount: user._count.entries,
        depositsCount: user._count.deposits + user._count.depositIntents,
        depositsAmount: (
          (depositByUser.get(user.id) ?? 0n) +
          (intentByUser.get(user.id) ?? 0n)
        ).toString(),
        withdrawalsCount: user._count.withdrawals,
        withdrawalsAmount: (
          withdrawalByUser.get(user.id) ?? 0n
        ).toString(),
        riskStatus: user.riskEvents.some(
          (event) =>
            event.severity === RiskEventSeverity.HIGH ||
            event.severity === RiskEventSeverity.CRITICAL,
        )
          ? "HIGH"
          : user.riskEvents.length > 0
            ? "OPEN"
            : "CLEAR",
      })),
      page,
      total,
    );
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayUsername: true,
        fullName: true,
        role: true,
        bannedAt: true,
        createdAt: true,
        walletAccounts: {
          where: { type: "MAIN" },
          select: { balanceSnapshot: true },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    return {
      id: user.id,
      username: user.displayUsername ?? user.username,
      fullName: user.fullName,
      email: this.maskEmail(user.email),
      role: user.role,
      accountStatus: user.bannedAt ? "SUSPENDED" : "ACTIVE",
      joinedAt: user.createdAt.toISOString(),
      balance: (user.walletAccounts[0]?.balanceSnapshot ?? 0n).toString(),
    };
  }

  async suspendUser(userId: string, adminId: string) {
    return this.setUserSuspension(userId, adminId, true);
  }

  async unsuspendUser(userId: string, adminId: string) {
    return this.setUserSuspension(userId, adminId, false);
  }

  async listEntries(query: ListQuery) {
    const page = this.parsePage(query);
    const search = query.q?.trim();
    const where: Prisma.EntryWhereInput = {
      createdAt: this.dateRange(query),
      ...(query.status === "WINNER"
        ? { isWinner: true }
        : query.status === "NON_WINNER"
          ? { isWinner: false }
          : {}),
      ...(search
        ? {
            OR: [
              { id: search },
              {
                user: {
                  OR: [
                    { username: { contains: search, mode: "insensitive" } },
                    {
                      displayUsername: {
                        contains: search,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              },
              {
                round: {
                  room: {
                    code: { contains: search, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, entries] = await Promise.all([
      this.prisma.entry.count({ where }),
      this.prisma.entry.findMany({
        where,
        skip: page.skip,
        take: page.pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          amount: true,
          ticketStart: true,
          ticketEnd: true,
          isWinner: true,
          createdAt: true,
          user: { select: { id: true, username: true, displayUsername: true } },
          round: {
            select: {
              id: true,
              roundNumber: true,
              status: true,
              room: { select: { id: true, code: true, name: true } },
            },
          },
        },
      }),
    ]);
    const riskByEntry = await this.openRiskByRelated(
      "ENTRY",
      entries.map((entry) => entry.id),
    );

    return this.pageResult(
      entries.map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt.toISOString(),
        playerId: entry.user.id,
        player: this.userLabel(entry.user),
        roomId: entry.round.room.id,
        room: entry.round.room.code,
        roomName: entry.round.room.name,
        roundId: entry.round.id,
        roundNumber: entry.round.roundNumber,
        amount: entry.amount.toString(),
        ticketStart: entry.ticketStart?.toString() ?? null,
        ticketEnd: entry.ticketEnd?.toString() ?? null,
        status: entry.round.status,
        isWinner: entry.isWinner,
        riskStatus: riskByEntry.get(entry.id) ?? "CLEAR",
      })),
      page,
      total,
    );
  }

  async listRounds(query: ListQuery) {
    const page = this.parsePage(query);
    const search = query.q?.trim();
    const status = this.enumValue(RoundStatus, query.status);
    const where: Prisma.RoundWhereInput = {
      status,
      openedAt: this.dateRange(query),
      ...(search
        ? {
            OR: [
              { id: search },
              {
                room: {
                  OR: [
                    { code: { contains: search, mode: "insensitive" } },
                    { name: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const [total, rounds] = await Promise.all([
      this.prisma.round.count({ where }),
      this.prisma.round.findMany({
        where,
        skip: page.skip,
        take: page.pageSize,
        orderBy: { openedAt: "desc" },
        select: {
          id: true,
          roundNumber: true,
          status: true,
          totalEntryAmount: true,
          payoutAmount: true,
          winnerUserId: true,
          openedAt: true,
          locksAt: true,
          lockedAt: true,
          drawingAt: true,
          spinningAt: true,
          settlingAt: true,
          completedAt: true,
          cancelledAt: true,
          serverSeedHash: true,
          serverSeedReveal: true,
          room: { select: { id: true, code: true, name: true } },
          _count: { select: { entries: true } },
        },
      }),
    ]);
    const riskByRound = await this.openRiskByRelated(
      "ROUND",
      rounds.map((round) => round.id),
    );

    return this.pageResult(
      rounds.map((round) => ({
        id: round.id,
        roundNumber: round.roundNumber,
        roomId: round.room.id,
        room: round.room.code,
        roomName: round.room.name,
        status: round.status,
        totalEntryAmount: round.totalEntryAmount.toString(),
        payoutAmount: round.payoutAmount.toString(),
        winnerUserId: round.winnerUserId,
        entryCount: round._count.entries,
        openedAt: round.openedAt.toISOString(),
        locksAt: round.locksAt?.toISOString() ?? null,
        lockedAt: round.lockedAt?.toISOString() ?? null,
        drawingAt: round.drawingAt?.toISOString() ?? null,
        spinningAt: round.spinningAt?.toISOString() ?? null,
        settlingAt: round.settlingAt?.toISOString() ?? null,
        completedAt: round.completedAt?.toISOString() ?? null,
        cancelledAt: round.cancelledAt?.toISOString() ?? null,
        durationMs: round.completedAt
          ? round.completedAt.getTime() - round.openedAt.getTime()
          : null,
        serverSeedHash: round.serverSeedHash,
        revealStatus:
          round.status === RoundStatus.COMPLETED && round.serverSeedReveal
            ? "REVEALED"
            : "HIDDEN",
        serverSeedReveal:
          round.status === RoundStatus.COMPLETED ? round.serverSeedReveal : null,
        riskStatus: riskByRound.get(round.id) ?? "CLEAR",
      })),
      page,
      total,
    );
  }

  async listRiskEvents(query: ListQuery & { severity?: string; type?: string }) {
    const page = this.parsePage(query);
    const status = this.enumValue(RiskEventStatus, query.status);
    const severity = this.enumValue(RiskEventSeverity, query.severity);
    const type = this.enumValue(RiskEventType, query.type);
    const search = query.q?.trim();
    const where: Prisma.RiskEventWhereInput = {
      status,
      severity,
      type,
      createdAt: this.dateRange(query),
      ...(search
        ? {
            OR: [
              { id: search },
              {
                user: {
                  OR: [
                    { username: { contains: search, mode: "insensitive" } },
                    {
                      displayUsername: {
                        contains: search,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const [total, events] = await Promise.all([
      this.prisma.riskEvent.count({ where }),
      this.prisma.riskEvent.findMany({
        where,
        skip: page.skip,
        take: page.pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          userId: true,
          roomId: true,
          roundId: true,
          type: true,
          severity: true,
          status: true,
          score: true,
          summary: true,
          reason: true,
          relatedType: true,
          relatedId: true,
          metadata: true,
          createdAt: true,
          reviewedAt: true,
          reviewNote: true,
          dismissedAt: true,
          user: { select: { username: true, displayUsername: true } },
        },
      }),
    ]);

    return this.pageResult(
      events.map((event) => ({
        id: event.id,
        createdAt: event.createdAt.toISOString(),
        severity: event.severity,
        score: event.score,
        type: event.type,
        player: event.user ? this.userLabel(event.user) : null,
        userId: event.userId,
        relatedType: event.relatedType,
        relatedId: event.relatedId,
        relatedEntity:
          event.relatedId ??
          event.roundId ??
          event.roomId ??
          event.userId,
        status: event.status,
        summary: event.summary || this.riskSummary(event.type, event.metadata),
        reason: event.reason,
        evidenceCount: this.riskEvidenceCount(event.metadata),
        metadata: this.sanitizeMetadata(event.metadata),
        reviewedAt: event.reviewedAt?.toISOString() ?? null,
        reviewNote: event.reviewNote,
        dismissedAt: event.dismissedAt?.toISOString() ?? null,
      })),
      page,
      total,
    );
  }

  async listAuditLogs(query: ListQuery & { action?: string }) {
    const page = this.parsePage(query);
    const action = this.enumValue(AdminAuditAction, query.action);
    const search = query.q?.trim();
    const where: Prisma.AdminAuditLogWhereInput = {
      action,
      createdAt: this.dateRange(query),
      ...(search
        ? {
            OR: [
              { id: search },
              { targetId: search },
              { targetType: { contains: search, mode: "insensitive" } },
              {
                actor: {
                  OR: [
                    { username: { contains: search, mode: "insensitive" } },
                    {
                      displayUsername: {
                        contains: search,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const [total, logs] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        skip: page.skip,
        take: page.pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          metadata: true,
          createdAt: true,
          actor: {
            select: {
              id: true,
              username: true,
              displayUsername: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return this.pageResult(
      logs.map((log) => ({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        actor: log.actor ? this.userLabel(log.actor) : "System",
        actorId: log.actor?.id ?? null,
        actorEmail: log.actor ? this.maskEmail(log.actor.email) : null,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        summary: `${log.action.replaceAll("_", " ")} on ${log.targetType.toLowerCase()}`,
        metadata: this.sanitizeMetadata(log.metadata),
      })),
      page,
      total,
    );
  }

  async getHealthSummary() {
    const system = await this.getSystemHealth();
    return {
      ...system,
      deployment: {
        checklist: [
          "Apply pending Prisma migrations before enabling payment review.",
          "Confirm Redis is available in staging and production.",
          "Confirm round-machine auto-start matches deployment policy.",
          "Verify Sentry alerts and backup recovery procedures.",
        ],
      },
    };
  }

  getSettingsSummary() {
    const env = getApiEnv();
    return {
      appEnvironment: env.APP_ENV,
      paymentProvider: env.PAYMENT_PROVIDER,
      telebirrReceiptVerificationEnabled:
        env.TELEBIRR_RECEIPT_VERIFICATION_ENABLED === true,
      depositMinimum: String(env.TELEBIRR_DEPOSIT_MIN),
      depositMaximum: String(env.TELEBIRR_DEPOSIT_MAX),
      redisEnabled: env.ENABLE_REDIS === true,
      trustedProxyHeaders: env.TRUST_PROXY_HEADERS === true,
      sentryConfigured: Boolean(env.SENTRY_DSN),
      localDevAuthEnabled:
        env.APP_ENV === "local" && env.ENABLE_LOCAL_DEV_AUTH === true,
      roundMachineAutoStart: env.ROUND_MACHINE_AUTO_START === true,
      readOnly: true,
    };
  }

  async listLedgerTransactions(query: {
    type?: string;
    referenceId?: string;
    take?: number;
  }) {
    const take = Math.max(1, Math.min(query.take ?? 100, 100));
    const transactions = await this.prisma.ledgerTransaction.findMany({
      where: {
        type: query.type as Prisma.EnumLedgerTransactionTypeFilter | undefined,
        referenceId: query.referenceId,
      },
      take,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
      },
    });

    return transactions.map((transaction) => ({
      ...transaction,
      createdAt: transaction.createdAt.toISOString(),
    }));
  }

  async listWorkerJobs(take = 100) {
    const safeTake = Math.max(1, Math.min(take, 100));
    return this.prisma.workerJobLog.findMany({
      take: safeTake,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        queue: true,
        name: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        error: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private async getSystemHealth() {
    const [database, redis, roundMachine] = await Promise.all([
      this.getDatabaseHealth(),
      this.redisService
        .ping()
        .then((result) => ({
          status: result.available
            ? ("ok" as const)
            : result.enabled
              ? ("down" as const)
              : ("unknown" as const),
          enabled: result.enabled,
          latencyMs: result.latencyMs,
        }))
        .catch(() => ({
          status: "down" as const,
          enabled: this.redisService.isEnabled(),
          latencyMs: null,
        })),
      this.roundMachineService.getRoundMachineHealthSnapshot(),
    ]);
    const staleCompletedRounds =
      roundMachine.staleRounds.staleCompletedOrCurrent ?? 0;
    const staleRunningRounds = roundMachine.staleRounds.warnings ?? 0;

    return {
      api:
        database.status === "ok" &&
        (redis.status === "ok" || redis.status === "unknown")
          ? ("ok" as const)
          : ("degraded" as const),
      database,
      redis,
      roundMachine: {
        running: roundMachine.running,
        enabled: roundMachine.enabled,
        startupMode: roundMachine.startupMode,
        lastTickAt: roundMachine.lastTickAt,
        nextTickAt: roundMachine.nextTickAt,
        staleCompletedRounds,
        staleRunningRounds,
        activeRooms: roundMachine.rooms.active,
        runningPermanentRooms: roundMachine.rooms.runningPermanent,
        instanceId: roundMachine.instance.id,
        pid: roundMachine.instance.pid,
      },
      sentryConfigured: Boolean(getApiEnv().SENTRY_DSN),
      appEnvironment: getApiEnv().APP_ENV,
      sampledAt: new Date().toISOString(),
    };
  }

  private async getDatabaseHealth() {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok" as const, latencyMs: Date.now() - startedAt };
    } catch {
      return { status: "down" as const, latencyMs: Date.now() - startedAt };
    }
  }

  private degradedSystemHealth(warning: string) {
    return {
      api: "degraded" as const,
      database: { status: "unknown" as const, latencyMs: null },
      redis: {
        status: "unknown" as const,
        enabled: this.redisService.isEnabled(),
        latencyMs: null,
      },
      roundMachine: {
        running: false,
        enabled: false,
        startupMode: "unknown",
        lastTickAt: null,
        nextTickAt: null,
        staleCompletedRounds: 0,
        staleRunningRounds: 0,
        activeRooms: 0,
        runningPermanentRooms: 0,
        instanceId: null,
        pid: null,
      },
      sentryConfigured: Boolean(getApiEnv().SENTRY_DSN),
      appEnvironment: getApiEnv().APP_ENV,
      sampledAt: new Date().toISOString(),
      warning,
    };
  }

  private async setUserSuspension(
    userId: string,
    adminId: string,
    suspend: boolean,
  ) {
    if (!userId) {
      throw new BadRequestException("userId is required.");
    }

    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, bannedAt: true, role: true },
    });

    if (!before) {
      throw new NotFoundException("User not found.");
    }

    if (before.role === Role.OWNER || before.role === Role.SUPER_ADMIN) {
      throw new BadRequestException("Owner accounts cannot be suspended here.");
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { bannedAt: suspend ? new Date() : null },
      select: {
        id: true,
        username: true,
        displayUsername: true,
        role: true,
        bannedAt: true,
      },
    });

    await this.auditService.recordAdminAction({
      actorId: adminId,
      action: suspend
        ? AdminAuditAction.USER_SUSPENDED
        : AdminAuditAction.USER_UNSUSPENDED,
      targetType: "USER",
      targetId: userId,
      before: {
        id: before.id,
        bannedAt: before.bannedAt?.toISOString() ?? null,
      },
      after: {
        id: user.id,
        bannedAt: user.bannedAt?.toISOString() ?? null,
      },
    });

    return {
      id: user.id,
      username: user.displayUsername ?? user.username,
      role: user.role,
      accountStatus: user.bannedAt ? "SUSPENDED" : "ACTIVE",
    };
  }

  private parsePage(query: ListQuery) {
    const parsedPage = Number(query.page ?? 1);
    const parsedPageSize = Number(query.pageSize ?? 25);
    const page =
      Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const pageSize =
      Number.isSafeInteger(parsedPageSize) && parsedPageSize > 0
        ? Math.min(parsedPageSize, 100)
        : 25;

    return { page, pageSize, skip: (page - 1) * pageSize };
  }

  private pageResult<T>(
    items: T[],
    page: { page: number; pageSize: number },
    total: number,
  ) {
    return {
      items,
      page: page.page,
      pageSize: page.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / page.pageSize)),
    };
  }

  private dateRange(query: ListQuery) {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    const range: Prisma.DateTimeFilter = {};

    if (from && !Number.isNaN(from.getTime())) range.gte = from;
    if (to && !Number.isNaN(to.getTime())) range.lte = to;

    return Object.keys(range).length > 0 ? range : undefined;
  }

  private enumValue<T extends Record<string, string>>(
    values: T,
    candidate?: string,
  ): T[keyof T] | undefined {
    if (!candidate) return undefined;
    const normalized = candidate.trim().toUpperCase();
    return Object.values(values).includes(normalized)
      ? (normalized as T[keyof T])
      : undefined;
  }

  private userLabel(user: {
    username: string;
    displayUsername?: string | null;
  }) {
    return user.displayUsername?.trim() || user.username;
  }

  private maskEmail(email: string) {
    const [local, domain] = email.split("@");
    if (!domain) return "***";
    const visible = local?.slice(0, 2) ?? "";
    return `${visible}${"*".repeat(Math.max(2, (local?.length ?? 2) - 2))}@${domain}`;
  }

  private riskSummary(type: RiskEventType, metadata: Prisma.JsonValue | null) {
    const record =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Prisma.JsonObject)
        : {};
    const reason = typeof record.reason === "string" ? record.reason : null;
    return reason ?? type.replaceAll("_", " ").toLowerCase();
  }

  private riskEvidenceCount(metadata: Prisma.JsonValue | null) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return 0;
    }

    const record = metadata as Prisma.JsonObject;
    const value = record.evidenceCount;

    if (typeof value === "number") {
      return value;
    }

    if (Array.isArray(record.evidence)) {
      return record.evidence.length;
    }

    return Object.keys(record).length;
  }

  private async openRiskByRelated(relatedType: string, ids: string[]) {
    if (ids.length === 0) {
      return new Map<string, string>();
    }

    const events = await this.prisma.riskEvent.findMany({
      where: {
        status: RiskEventStatus.OPEN,
        relatedType,
        relatedId: { in: ids },
      },
      select: {
        relatedId: true,
        severity: true,
      },
    });
    const map = new Map<string, RiskEventSeverity>();

    for (const event of events) {
      if (!event.relatedId) continue;
      const existing = map.get(event.relatedId);
      if (
        !existing ||
        this.riskSeverityRank(event.severity) > this.riskSeverityRank(existing)
      ) {
        map.set(event.relatedId, event.severity);
      }
    }

    return new Map(
      [...map.entries()].map(([id, severity]) => [id, severity as string]),
    );
  }

  private riskSeverityRank(severity: RiskEventSeverity) {
    switch (severity) {
      case RiskEventSeverity.CRITICAL:
        return 4;
      case RiskEventSeverity.HIGH:
        return 3;
      case RiskEventSeverity.MEDIUM:
        return 2;
      case RiskEventSeverity.LOW:
      default:
        return 1;
    }
  }

  private sanitizeMetadata(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeMetadata(item));
    }

    const blocked = [
      "password",
      "token",
      "secret",
      "serverseed",
      "rawhtml",
      "receiptHtml",
      "ipHash",
      "ipAddress",
      "userAgent",
      "userAgentHash",
      "deviceHash",
      "fingerprint",
      "session",
      "authorization",
    ];
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !blocked.some((blockedKey) =>
              key.toLowerCase().includes(blockedKey.toLowerCase()),
            ),
        )
        .map(([key, item]) => [
          key,
          this.sanitizeMetadata(item === undefined ? null : item),
        ]),
    );
  }

  private startOfToday() {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }
}

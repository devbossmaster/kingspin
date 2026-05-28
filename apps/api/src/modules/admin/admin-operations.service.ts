import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AdminAuditAction, Prisma, RiskEventStatus } from "@kingspin/db";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { FraudService } from "../fraud/fraud.service";

@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly fraudService: FraudService,
  ) {}

  async getDashboard() {
    const [
      activeRooms,
      activeRounds,
      openPool,
      recentEntries,
      recentDeposits,
      recentWithdrawals,
      suspiciousCount,
      failedJobs,
    ] = await Promise.all([
      this.prisma.room.count({ where: { status: "ACTIVE" } }),
      this.prisma.round.count({
        where: {
          status: {
            in: ["OPEN", "LOCKED", "DRAWING", "SPINNING", "SETTLING"],
          },
        },
      }),
      this.prisma.entry.aggregate({
        where: {
          round: { status: "OPEN" },
        },
        _sum: { amount: true },
      }),
      this.prisma.entry.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          roundId: true,
          userId: true,
          amount: true,
          createdAt: true,
        },
      }),
      this.prisma.deposit.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.withdrawal.findMany({
        take: 10,
        orderBy: { requestedAt: "desc" },
      }),
      this.prisma.riskEvent.count({
        where: {
          status: "OPEN",
          severity: { in: ["HIGH", "CRITICAL"] },
        },
      }),
      this.prisma.workerJobLog.count({
        where: { status: { in: ["FAILED", "DEAD_LETTER"] } },
      }),
    ]);

    return {
      activeRooms,
      activeRounds,
      totalOpenPool: (openPool._sum.amount ?? 0n).toString(),
      recentEntries: recentEntries.map((entry) => ({
        ...entry,
        amount: entry.amount.toString(),
        createdAt: entry.createdAt.toISOString(),
      })),
      recentDeposits: recentDeposits.map((deposit) => ({
        id: deposit.id,
        userId: deposit.userId,
        provider: deposit.provider,
        amount: deposit.amount.toString(),
        currency: deposit.currency,
        status: deposit.status,
        createdAt: deposit.createdAt.toISOString(),
      })),
      recentWithdrawals: recentWithdrawals.map((withdrawal) => ({
        id: withdrawal.id,
        userId: withdrawal.userId,
        provider: withdrawal.provider,
        amount: withdrawal.amount.toString(),
        currency: withdrawal.currency,
        status: withdrawal.status,
        requestedAt: withdrawal.requestedAt.toISOString(),
      })),
      suspiciousActivityCount: suspiciousCount,
      failedJobCount: failedJobs,
    };
  }

  async listUsers(query: { search?: string; take?: number }) {
    const search = query.search?.trim();
    const take = Math.max(1, Math.min(query.take ?? 50, 200));
    const users = await this.prisma.user.findMany({
      where: search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { username: { contains: search, mode: "insensitive" } },
              { fullName: { contains: search, mode: "insensitive" } },
              { id: search },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        role: true,
        bannedAt: true,
        createdAt: true,
      },
    });

    return users.map((user) => ({
      ...user,
      bannedAt: user.bannedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    }));
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        role: true,
        emailVerified: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
        walletAccounts: true,
        entries: {
          take: 25,
          orderBy: { createdAt: "desc" },
        },
        deposits: {
          take: 25,
          orderBy: { createdAt: "desc" },
        },
        withdrawals: {
          take: 25,
          orderBy: { requestedAt: "desc" },
        },
        riskEvents: {
          take: 25,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    const ledgerTransactions = await this.prisma.ledgerTransaction.findMany({
      where: {
        entries: {
          some: {
            walletAccount: { userId },
          },
        },
      },
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { entries: true },
    });

    return {
      ...user,
      bannedAt: user.bannedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      walletAccounts: user.walletAccounts.map((wallet) => ({
        ...wallet,
        balanceSnapshot: wallet.balanceSnapshot.toString(),
        createdAt: wallet.createdAt.toISOString(),
        updatedAt: wallet.updatedAt.toISOString(),
      })),
      entries: user.entries.map((entry) => ({
        ...entry,
        amount: entry.amount.toString(),
        ticketStart: entry.ticketStart?.toString() ?? null,
        ticketEnd: entry.ticketEnd?.toString() ?? null,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      })),
      deposits: user.deposits.map((deposit) => ({
        ...deposit,
        amount: deposit.amount.toString(),
        createdAt: deposit.createdAt.toISOString(),
        updatedAt: deposit.updatedAt.toISOString(),
        confirmedAt: deposit.confirmedAt?.toISOString() ?? null,
      })),
      withdrawals: user.withdrawals.map((withdrawal) => ({
        id: withdrawal.id,
        userId: withdrawal.userId,
        walletAccountId: withdrawal.walletAccountId,
        provider: withdrawal.provider,
        amount: withdrawal.amount.toString(),
        currency: withdrawal.currency,
        status: withdrawal.status,
        providerReference: withdrawal.providerReference,
        requestedAt: withdrawal.requestedAt.toISOString(),
        reviewedAt: withdrawal.reviewedAt?.toISOString() ?? null,
        reviewedByAdminId: withdrawal.reviewedByAdminId,
        paidAt: withdrawal.paidAt?.toISOString() ?? null,
        rejectionReason: withdrawal.rejectionReason,
      })),
      riskEvents: user.riskEvents.map((event) =>
        this.fraudService.toRiskEventSnapshot(event),
      ),
      ledgerTransactions: ledgerTransactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        referenceType: transaction.referenceType,
        referenceId: transaction.referenceId,
        idempotencyKey: transaction.idempotencyKey,
        metadata: transaction.metadata,
        createdAt: transaction.createdAt.toISOString(),
        entries: transaction.entries.map((entry) => ({
          id: entry.id,
          walletAccountId: entry.walletAccountId,
          direction: entry.direction,
          amount: entry.amount.toString(),
          balanceAfterSnapshot:
            entry.balanceAfterSnapshot?.toString() ?? null,
          createdAt: entry.createdAt.toISOString(),
        })),
      })),
    };
  }

  async suspendUser(userId: string, adminId: string) {
    return this.setUserSuspension(userId, adminId, true);
  }

  async unsuspendUser(userId: string, adminId: string) {
    return this.setUserSuspension(userId, adminId, false);
  }

  async listRooms() {
    const rooms = await this.prisma.room.findMany({
      orderBy: [{ status: "asc" }, { code: "asc" }],
      include: {
        category: {
          select: { name: true, slug: true },
        },
        _count: {
          select: { rounds: true },
        },
      },
    });

    return rooms.map((room) => ({
      ...room,
      fixedEntryAmount: room.fixedEntryAmount?.toString() ?? null,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      activatedAt: room.activatedAt?.toISOString() ?? null,
      pausedAt: room.pausedAt?.toISOString() ?? null,
      closedAt: room.closedAt?.toISOString() ?? null,
      archivedAt: room.archivedAt?.toISOString() ?? null,
    }));
  }

  async listRounds(take = 100) {
    const safeTake = Math.max(1, Math.min(take, 250));
    const rounds = await this.prisma.round.findMany({
      take: safeTake,
      orderBy: { openedAt: "desc" },
      include: {
        room: {
          select: { code: true, name: true },
        },
        _count: { select: { entries: true } },
      },
    });

    return rounds.map((round) => ({
      ...round,
      totalEntryAmount: round.totalEntryAmount.toString(),
      houseFeeAmount: round.houseFeeAmount.toString(),
      payoutAmount: round.payoutAmount.toString(),
      winningTicket: round.winningTicket?.toString() ?? null,
      openedAt: round.openedAt.toISOString(),
      locksAt: round.locksAt?.toISOString() ?? null,
      lockedAt: round.lockedAt?.toISOString() ?? null,
      completedAt: round.completedAt?.toISOString() ?? null,
    }));
  }

  async listLedgerTransactions(query: {
    type?: string;
    referenceId?: string;
    take?: number;
  }) {
    const take = Math.max(1, Math.min(query.take ?? 100, 250));
    const transactions = await this.prisma.ledgerTransaction.findMany({
      where: {
        type: query.type as Prisma.EnumLedgerTransactionTypeFilter | undefined,
        referenceId: query.referenceId,
      },
      take,
      orderBy: { createdAt: "desc" },
      include: { entries: true },
    });

    return transactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      referenceType: transaction.referenceType,
      referenceId: transaction.referenceId,
      idempotencyKey: transaction.idempotencyKey,
      metadata: transaction.metadata,
      createdAt: transaction.createdAt.toISOString(),
      entries: transaction.entries.map((entry) => ({
        id: entry.id,
        walletAccountId: entry.walletAccountId,
        direction: entry.direction,
        amount: entry.amount.toString(),
        balanceAfterSnapshot: entry.balanceAfterSnapshot?.toString() ?? null,
        createdAt: entry.createdAt.toISOString(),
      })),
    }));
  }

  async listAuditLogs(take = 100) {
    const safeTake = Math.max(1, Math.min(take, 250));
    const logs = await this.prisma.adminAuditLog.findMany({
      take: safeTake,
      orderBy: { createdAt: "desc" },
      include: {
        actor: { select: { id: true, username: true, email: true } },
      },
    });

    return logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    }));
  }

  async listWorkerJobs(take = 100) {
    const safeTake = Math.max(1, Math.min(take, 250));
    return this.prisma.workerJobLog.findMany({
      take: safeTake,
      orderBy: { createdAt: "desc" },
    });
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
      select: { id: true, bannedAt: true },
    });

    if (!before) {
      throw new NotFoundException("User not found.");
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { bannedAt: suspend ? new Date() : null },
      select: {
        id: true,
        email: true,
        username: true,
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
      before,
      after: {
        id: user.id,
        bannedAt: user.bannedAt?.toISOString() ?? null,
      },
    });

    return {
      ...user,
      bannedAt: user.bannedAt?.toISOString() ?? null,
    };
  }
}

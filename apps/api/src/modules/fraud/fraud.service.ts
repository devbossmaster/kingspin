import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  Prisma,
  RiskEventSeverity,
  RiskEventStatus,
  RiskEventType,
  RoundStatus,
  type RiskEvent,
} from '@kingspin/db';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { getApiEnv } from '../../config/api-env';
import { RedisService } from '../redis/redis.service';

export type FraudCheckName =
  | 'DUPLICATE_IP_BETTING'
  | 'SAME_DEVICE_MULTI_ACCOUNT'
  | 'REPEATED_WINNER_ANOMALY'
  | 'MULTI_ACCOUNT_PATTERN'
  | 'RAPID_ENTRY_ATTEMPTS';

export type RiskFingerprintInput = {
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  sessionId?: string | null;
};

export type RiskFingerprint = {
  ipHash: string | null;
  userAgentHash: string | null;
  deviceHash: string | null;
  sessionHash: string | null;
};

export type FraudEvaluationInput = {
  userId: string;
  roomId?: string;
  roundId?: string | null;
  amount?: bigint;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  requestId?: string | null;
};

export type FraudEvaluationResult = {
  decision: 'ALLOW' | 'REVIEW' | 'BLOCK';
  findings: Array<{
    check: FraudCheckName;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  plannedChecks: Array<{
    check: FraudCheckName;
    status: 'ACTIVE';
    description: string;
  }>;
  evaluatedAt: string;
};

type FraudFinding = FraudEvaluationResult['findings'][number];

type LocalRapidEntryBucket = {
  count: number;
  resetAt: number;
};

type RiskMetadata = Record<string, unknown>;

const RAPID_ENTRY_ATTEMPT_WINDOW_MS = 15_000;
const RAPID_ENTRY_ATTEMPT_MAX = 4;
const ENTRY_SIGNAL_WINDOW_MS = 30 * 60 * 1000;
const MULTI_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPEATED_WINNER_WINDOW_MS = 24 * 60 * 60 * 1000;
const MANY_FAILED_RECEIPT_WINDOW_MS = 15 * 60 * 1000;

const SEVERITY_SCORE: Record<RiskEventSeverity, number> = {
  LOW: 15,
  MEDIUM: 40,
  HIGH: 70,
  CRITICAL: 90,
};

const SEVERITY_RANK: Record<RiskEventSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const SENSITIVE_METADATA_KEYS = [
  'ip',
  'ipAddress',
  'userAgent',
  'cookie',
  'authorization',
  'password',
  'secret',
  'token',
  'rawHtml',
  'receiptHtml',
  'rawReceiptHtml',
];

@Injectable()
export class FraudService {
  private readonly rapidEntryBuckets = new Map<string, LocalRapidEntryBucket>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  async evaluateEntryAttempt(
    input: FraudEvaluationInput,
  ): Promise<FraudEvaluationResult> {
    const findings = await this.evaluateRapidEntryAttempts(input);

    return {
      decision: findings.some((finding) => finding.severity === 'HIGH')
        ? 'BLOCK'
        : findings.length > 0
          ? 'REVIEW'
          : 'ALLOW',
      findings,
      plannedChecks: this.getPlannedChecks(),
      evaluatedAt: new Date().toISOString(),
    };
  }

  getPlannedChecks(): FraudEvaluationResult['plannedChecks'] {
    return [
      {
        check: 'DUPLICATE_IP_BETTING',
        status: 'ACTIVE',
        description:
          'Creates review-only risk events when multiple accounts enter the same round from the same hashed IP/device.',
      },
      {
        check: 'SAME_DEVICE_MULTI_ACCOUNT',
        status: 'ACTIVE',
        description:
          'Correlates multiple accounts by privacy-safe device and network hashes.',
      },
      {
        check: 'REPEATED_WINNER_ANOMALY',
        status: 'ACTIVE',
        description:
          'Creates review-only risk events for conservative repeated-winner anomalies.',
      },
      {
        check: 'MULTI_ACCOUNT_PATTERN',
        status: 'ACTIVE',
        description:
          'Groups linked-account evidence for admin review without automatic bans.',
      },
    ];
  }

  getMigrationTodos() {
    return [
      'Tune risk thresholds with closed-alpha data and false-positive review.',
      'Run legal/privacy review before enabling persistent device identifiers beyond first-party cookies.',
      'Keep fraud events advisory until policy, appeals, and support workflows are approved.',
    ];
  }

  createRiskFingerprint(input: RiskFingerprintInput): RiskFingerprint {
    return {
      ipHash: this.hashSignal(input.ip),
      userAgentHash: this.hashSignal(input.userAgent),
      deviceHash: this.hashSignal(input.deviceId ?? input.sessionId),
      sessionHash: this.hashSignal(input.sessionId),
    };
  }

  async evaluateEntryPlacement(input: FraudEvaluationInput & {
    entryId: string;
    roundId: string;
  }) {
    const fingerprint = this.createRiskFingerprint({
      ip: input.ipAddress,
      userAgent: input.userAgent,
      deviceId: input.deviceId,
    });

    await this.recordRiskSignal({
      userId: input.userId,
      type: 'ENTRY_PLACED',
      action: 'ENTRY_PLACED',
      roomId: input.roomId,
      roundId: input.roundId,
      relatedType: 'ENTRY',
      relatedId: input.entryId,
      fingerprint,
      metadata: {
        amount: input.amount?.toString() ?? null,
        requestId: input.requestId ?? null,
      },
    });

    await Promise.all([
      this.evaluateDuplicateIpOrDeviceBetting(input, fingerprint),
      this.evaluateMultiAccountPattern(input, fingerprint),
    ]);
  }

  async evaluateRoundWinner(roundId: string) {
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      select: {
        id: true,
        roomId: true,
        status: true,
        winnerUserId: true,
        payoutAmount: true,
        completedAt: true,
      },
    });

    if (
      !round ||
      round.status !== RoundStatus.COMPLETED ||
      !round.winnerUserId ||
      !round.completedAt
    ) {
      return null;
    }

    const since = new Date(round.completedAt.getTime() - REPEATED_WINNER_WINDOW_MS);
    const [wins, entries, user] = await Promise.all([
      this.prisma.round.count({
        where: {
          winnerUserId: round.winnerUserId,
          status: RoundStatus.COMPLETED,
          completedAt: { gte: since, lte: round.completedAt },
        },
      }),
      this.prisma.entry.count({
        where: {
          userId: round.winnerUserId,
          createdAt: { gte: since, lte: round.completedAt },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: round.winnerUserId },
        select: { createdAt: true },
      }),
    ]);

    const accountAgeHours = user
      ? Math.max(0, (round.completedAt.getTime() - user.createdAt.getTime()) / 3_600_000)
      : null;
    const newAccountLargeWin =
      accountAgeHours !== null &&
      accountAgeHours <= 24 &&
      round.payoutAmount >= 10_000n;
    const repeatedLowVolumeWins = wins >= 3 && entries <= wins * 2;

    if (!newAccountLargeWin && !repeatedLowVolumeWins) {
      return null;
    }

    return this.createOrUpdateRiskEvent({
      userId: round.winnerUserId,
      roomId: round.roomId,
      roundId: round.id,
      type: RiskEventType.REPEATED_WINNER_ANOMALY,
      severity: wins >= 5 || newAccountLargeWin ? 'HIGH' : 'MEDIUM',
      score: wins >= 5 || newAccountLargeWin ? 72 : 48,
      summary: 'Repeated winner pattern requires review.',
      reason: newAccountLargeWin
        ? 'New account won a large payout shortly after creation.'
        : 'Winner frequency is high compared with recent entry volume.',
      relatedType: 'ROUND',
      relatedId: round.id,
      metadata: {
        wins24h: wins,
        entries24h: entries,
        payoutAmount: round.payoutAmount.toString(),
        accountAgeHours:
          accountAgeHours === null ? null : Math.round(accountAgeHours * 10) / 10,
        reviewOnly: true,
      },
    });
  }

  async evaluateDepositAttempt(input: {
    userId?: string | null;
    depositIntentId?: string | null;
    receiptNo?: string | null;
    status:
      | 'DUPLICATE_RECEIPT'
      | 'RECEIVER_MISMATCH'
      | 'AMOUNT_MISMATCH'
      | 'FETCH_FAILED'
      | 'PARSE_AMBIGUOUS'
      | 'FAILED_ATTEMPT';
    reason: string;
    metadata?: RiskMetadata;
  }) {
    const duplicateDifferentUser =
      input.status === 'DUPLICATE_RECEIPT' &&
      input.metadata?.existingUserId &&
      input.metadata.existingUserId !== input.userId;
    const failedCount =
      input.userId && input.status !== 'DUPLICATE_RECEIPT'
        ? await this.countRecentFailedReceiptAttempts(input.userId)
        : 0;
    const severity: RiskEventSeverity =
      duplicateDifferentUser || failedCount >= 5
        ? RiskEventSeverity.HIGH
        : input.status === 'RECEIVER_MISMATCH' ||
            input.status === 'AMOUNT_MISMATCH'
          ? RiskEventSeverity.HIGH
          : RiskEventSeverity.MEDIUM;
    const type =
      input.status === 'DUPLICATE_RECEIPT'
        ? RiskEventType.DUPLICATE_PAYMENT_RECEIPT
        : failedCount >= 5
          ? RiskEventType.MANY_FAILED_RECEIPTS
          : RiskEventType.DEPOSIT_WEBHOOK_MISMATCH;

    return this.createOrUpdateRiskEvent({
      userId: input.userId,
      type,
      severity,
      score: failedCount >= 5 ? 82 : SEVERITY_SCORE[severity],
      summary:
        type === RiskEventType.MANY_FAILED_RECEIPTS
          ? 'Many failed Telebirr receipt attempts require review.'
          : 'Telebirr receipt abuse signal requires review.',
      reason: input.reason,
      relatedType: 'DEPOSIT_INTENT',
      relatedId: input.depositIntentId ?? undefined,
      metadata: {
        ...input.metadata,
        receiptNo: input.receiptNo,
        failedAttempts15m: failedCount,
        reviewOnly: true,
      },
    });
  }

  async evaluateWithdrawalRequest(input: {
    userId: string;
    withdrawalId: string;
    amount: bigint;
    destination?: Prisma.JsonValue | null;
    requestedAt?: Date;
  }) {
    const requestedAt = input.requestedAt ?? new Date();
    const since24h = new Date(requestedAt.getTime() - 24 * 60 * 60 * 1000);
    const since48h = new Date(requestedAt.getTime() - 48 * 60 * 60 * 1000);
    const destinationHash = this.hashSignal(
      this.normalizeDestination(input.destination),
    );
    const sameDestinationPromise: Promise<Array<{ userId: string | null }>> =
      destinationHash
        ? this.prisma.riskSignal.findMany({
            where: {
              type: 'WITHDRAWAL_REQUESTED',
              deviceHash: destinationHash,
              createdAt: { gte: since48h, lte: requestedAt },
            },
            distinct: ['userId'],
            select: { userId: true },
            take: 10,
          })
        : Promise.resolve([]);

    const [user, recentWithdrawals, recentDeposits, recentLargeWins, sameDestination] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: input.userId },
          select: { createdAt: true },
        }),
        this.prisma.withdrawal.aggregate({
          where: {
            userId: input.userId,
            requestedAt: { gte: since24h, lte: requestedAt },
          },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.depositIntent.count({
          where: {
            userId: input.userId,
            status: { in: ['CREDITED', 'NEEDS_MANUAL_REVIEW'] },
            updatedAt: { gte: since48h, lte: requestedAt },
          },
        }),
        this.prisma.round.count({
          where: {
            winnerUserId: input.userId,
            status: RoundStatus.COMPLETED,
            completedAt: { gte: since48h, lte: requestedAt },
            payoutAmount: { gte: input.amount },
          },
        }),
        sameDestinationPromise,
      ]);

    await this.recordRiskSignal({
      userId: input.userId,
      type: 'WITHDRAWAL_REQUESTED',
      action: 'WITHDRAWAL_REQUESTED',
      relatedType: 'WITHDRAWAL',
      relatedId: input.withdrawalId,
      fingerprint: {
        ipHash: null,
        userAgentHash: null,
        deviceHash: destinationHash,
        sessionHash: null,
      },
      metadata: {
        amount: input.amount.toString(),
        destinationHashPresent: Boolean(destinationHash),
      },
    });

    const accountAgeHours = user
      ? Math.max(0, (requestedAt.getTime() - user.createdAt.getTime()) / 3_600_000)
      : null;
    const recentAmount = recentWithdrawals._sum.amount ?? 0n;
    const evidence = [
      recentWithdrawals._count >= 3 ? 'many_withdrawals_24h' : null,
      recentAmount >= input.amount * 3n ? 'withdrawal_amount_spike_24h' : null,
      recentDeposits > 0 ? 'withdrawal_after_recent_deposit_or_manual_review' : null,
      recentLargeWins > 0 ? 'withdrawal_after_large_win' : null,
      accountAgeHours !== null && accountAgeHours <= 24 ? 'new_account' : null,
      sameDestination.filter((item) => item.userId && item.userId !== input.userId)
        .length > 0
        ? 'destination_reused_by_multiple_users'
        : null,
    ].filter(Boolean);

    if (evidence.length === 0) {
      return null;
    }

    return this.createOrUpdateRiskEvent({
      userId: input.userId,
      type:
        recentDeposits > 0
          ? RiskEventType.WITHDRAWAL_AFTER_NEW_DEPOSIT
          : RiskEventType.SUSPICIOUS_WITHDRAWAL,
      severity: evidence.length >= 3 ? 'HIGH' : 'MEDIUM',
      score: Math.min(90, 35 + evidence.length * 15),
      summary: 'Withdrawal request requires risk review.',
      reason: 'Withdrawal pattern matched conservative review signals.',
      relatedType: 'WITHDRAWAL',
      relatedId: input.withdrawalId,
      deviceHash: destinationHash,
      metadata: {
        evidence,
        recentWithdrawalCount24h: recentWithdrawals._count,
        recentWithdrawalAmount24h: recentAmount.toString(),
        recentCreditedOrReviewDeposits48h: recentDeposits,
        recentLargeWins48h: recentLargeWins,
        linkedDestinationUsers: sameDestination
          .map((item) => item.userId)
          .filter((value): value is string => Boolean(value))
          .slice(0, 10),
        accountAgeHours:
          accountAgeHours === null ? null : Math.round(accountAgeHours * 10) / 10,
        reviewOnly: true,
      },
    });
  }

  async evaluateUser(userId: string) {
    const events = await this.prisma.riskEvent.findMany({
      where: { userId, status: RiskEventStatus.OPEN },
      select: { score: true, severity: true },
    });
    const score = Math.min(
      100,
      events.reduce((sum, event) => sum + Math.max(event.score, 0), 0),
    );

    return {
      userId,
      score,
      severity: this.severityFromScore(score),
      openEvents: events.length,
    };
  }

  async createRiskEvent(input: {
    userId?: string | null;
    roomId?: string | null;
    roundId?: string | null;
    type: keyof typeof RiskEventType | RiskEventType;
    severity: keyof typeof RiskEventSeverity | RiskEventSeverity;
    score?: number;
    summary?: string;
    reason?: string | null;
    relatedType?: string | null;
    relatedId?: string | null;
    ipHash?: string | null;
    userAgentHash?: string | null;
    deviceHash?: string | null;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.createOrUpdateRiskEvent(input);
  }

  async createOrUpdateRiskEvent(input: {
    userId?: string | null;
    roomId?: string | null;
    roundId?: string | null;
    type: keyof typeof RiskEventType | RiskEventType;
    severity: keyof typeof RiskEventSeverity | RiskEventSeverity;
    score?: number;
    summary?: string;
    reason?: string | null;
    relatedType?: string | null;
    relatedId?: string | null;
    ipHash?: string | null;
    userAgentHash?: string | null;
    deviceHash?: string | null;
    metadata?: Prisma.InputJsonValue;
  }) {
    const type = input.type as RiskEventType;
    const severity = input.severity as RiskEventSeverity;
    const score = this.clampScore(input.score ?? SEVERITY_SCORE[severity]);
    const metadata = this.sanitizeMetadata(input.metadata);
    const existing = await this.findOpenDuplicateRiskEvent({
      type,
      userId: input.userId,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      roomId: input.roomId,
      roundId: input.roundId,
    });

    if (existing) {
      const mergedSeverity = this.maxSeverity(existing.severity, severity);
      const event = await this.prisma.riskEvent.update({
        where: { id: existing.id },
        data: {
          severity: mergedSeverity,
          score: Math.max(existing.score, score),
          summary: input.summary ?? existing.summary,
          reason: input.reason ?? existing.reason,
          roomId: input.roomId ?? existing.roomId,
          roundId: input.roundId ?? existing.roundId,
          relatedType: input.relatedType ?? existing.relatedType,
          relatedId: input.relatedId ?? existing.relatedId,
          ipHash: input.ipHash ?? existing.ipHash,
          userAgentHash: input.userAgentHash ?? existing.userAgentHash,
          deviceHash: input.deviceHash ?? existing.deviceHash,
          metadata: this.mergeMetadata(existing.metadata, metadata),
        },
      });

      return this.toRiskEventSnapshot(event);
    }

    const event = await this.prisma.riskEvent.create({
      data: {
        userId: input.userId ?? null,
        roomId: input.roomId ?? null,
        roundId: input.roundId ?? null,
        type,
        severity,
        status: RiskEventStatus.OPEN,
        score,
        summary: input.summary ?? this.defaultSummary(type),
        reason: input.reason ?? null,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        ipHash: input.ipHash ?? null,
        userAgentHash: input.userAgentHash ?? null,
        deviceHash: input.deviceHash ?? null,
        metadata,
      },
    });

    return this.toRiskEventSnapshot(event);
  }

  async listRiskEvents(
    filters: {
      status?: RiskEventStatus;
      severity?: RiskEventSeverity;
      userId?: string;
      take?: number;
    } = {},
  ) {
    const take = Math.max(1, Math.min(filters.take ?? 50, 200));
    const events = await this.prisma.riskEvent.findMany({
      where: {
        status: filters.status,
        severity: filters.severity,
        userId: filters.userId,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return events.map((event) => this.toRiskEventSnapshot(event));
  }

  async reviewRiskEvent(
    id: string,
    adminId: string,
    status: RiskEventStatus,
    note?: string | null,
  ) {
    if (
      status !== RiskEventStatus.REVIEWED &&
      status !== RiskEventStatus.DISMISSED &&
      status !== RiskEventStatus.ACTIONED &&
      status !== RiskEventStatus.RESOLVED
    ) {
      throw new BadRequestException('Invalid risk event review status.');
    }

    const existing = await this.prisma.riskEvent.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Risk event not found.');
    }

    const event = await this.prisma.riskEvent.update({
      where: { id },
      data: {
        status,
        reviewedByAdminId: adminId,
        reviewedAt: new Date(),
        reviewNote: note?.trim() || undefined,
        dismissedAt:
          status === RiskEventStatus.DISMISSED ? new Date() : undefined,
        dismissedBy: status === RiskEventStatus.DISMISSED ? adminId : undefined,
      },
    });

    return this.toRiskEventSnapshot(event);
  }

  toRiskEventSnapshot(event: RiskEvent) {
    return {
      id: event.id,
      userId: event.userId,
      roomId: event.roomId,
      roundId: event.roundId,
      type: event.type,
      severity: event.severity,
      status: event.status,
      score: event.score,
      summary: event.summary,
      reason: event.reason,
      relatedType: event.relatedType,
      relatedId: event.relatedId,
      ipHash: event.ipHash,
      userAgentHash: event.userAgentHash,
      deviceHash: event.deviceHash,
      metadata: this.sanitizeMetadata(event.metadata),
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      reviewedByAdminId: event.reviewedByAdminId,
      reviewedAt: event.reviewedAt?.toISOString() ?? null,
      reviewNote: event.reviewNote,
      dismissedAt: event.dismissedAt?.toISOString() ?? null,
      dismissedBy: event.dismissedBy,
    };
  }

  private async evaluateRapidEntryAttempts(
    input: FraudEvaluationInput,
  ): Promise<FraudFinding[]> {
    if (!input.userId || !input.roundId) {
      return [];
    }

    const key = this.getRapidEntryKey(input.userId, input.roundId);
    const count = await this.incrementRapidEntryAttempt(key);

    if (count === null) {
      await this.createOrUpdateRiskEvent({
        userId: input.userId,
        roomId: input.roomId,
        roundId: input.roundId,
        type: RiskEventType.ENTRY_RATE_LIMIT_HIT,
        severity: RiskEventSeverity.HIGH,
        score: 80,
        summary: 'Rapid entry protection unavailable in deployed environment.',
        reason: 'Redis-backed rate limit storage was unavailable.',
        relatedType: 'ROUND',
        relatedId: input.roundId,
        metadata: {
          redisAvailable: false,
          requestId: input.requestId ?? null,
        },
      });

      return [
        {
          check: 'RAPID_ENTRY_ATTEMPTS',
          severity: 'HIGH',
          message:
            'Rapid entry protection is unavailable because Redis is required in production.',
          metadata: {
            roomId: input.roomId ?? null,
            roundId: input.roundId,
            redisAvailable: false,
          },
        },
      ];
    }

    if (count <= RAPID_ENTRY_ATTEMPT_MAX) {
      return [];
    }

    await this.createOrUpdateRiskEvent({
      userId: input.userId,
      roomId: input.roomId,
      roundId: input.roundId,
      type: RiskEventType.ENTRY_RATE_LIMIT_HIT,
      severity: RiskEventSeverity.HIGH,
      score: 75,
      summary: 'Rapid entry attempts exceeded the review threshold.',
      reason: 'Too many entry attempts for one user and round in a short window.',
      relatedType: 'ROUND',
      relatedId: input.roundId,
      metadata: {
        roomId: input.roomId ?? null,
        roundId: input.roundId,
        count,
        threshold: RAPID_ENTRY_ATTEMPT_MAX,
        windowMs: RAPID_ENTRY_ATTEMPT_WINDOW_MS,
      },
    });

    return [
      {
        check: 'RAPID_ENTRY_ATTEMPTS',
        severity: 'HIGH',
        message: 'Too many entry attempts for this round in a short window.',
        metadata: {
          roomId: input.roomId ?? null,
          roundId: input.roundId,
          count,
          threshold: RAPID_ENTRY_ATTEMPT_MAX,
          windowMs: RAPID_ENTRY_ATTEMPT_WINDOW_MS,
        },
      },
    ];
  }

  private async evaluateDuplicateIpOrDeviceBetting(
    input: FraudEvaluationInput & { entryId: string; roundId: string },
    fingerprint: RiskFingerprint,
  ) {
    if (!fingerprint.ipHash && !fingerprint.deviceHash) {
      return null;
    }

    const since = new Date(Date.now() - ENTRY_SIGNAL_WINDOW_MS);
    const evidence = await this.prisma.riskSignal.findMany({
      where: {
        type: 'ENTRY_PLACED',
        roundId: input.roundId,
        createdAt: { gte: since },
        OR: [
          fingerprint.ipHash ? { ipHash: fingerprint.ipHash } : undefined,
          fingerprint.deviceHash
            ? { deviceHash: fingerprint.deviceHash }
            : undefined,
        ].filter(Boolean) as Prisma.RiskSignalWhereInput[],
      },
      select: {
        userId: true,
        relatedId: true,
        ipHash: true,
        deviceHash: true,
        roundId: true,
      },
      take: 50,
    });
    const linkedUserIds = [
      ...new Set(evidence.map((item) => item.userId).filter(Boolean)),
    ] as string[];

    if (linkedUserIds.length < 2) {
      return null;
    }

    const severity =
      linkedUserIds.length >= 3
        ? RiskEventSeverity.HIGH
        : RiskEventSeverity.MEDIUM;

    return this.createOrUpdateRiskEvent({
      userId: input.userId,
      roomId: input.roomId,
      roundId: input.roundId,
      type: RiskEventType.DUPLICATE_IP_BETTING,
      severity,
      score: linkedUserIds.length >= 3 ? 72 : 45,
      summary: 'Multiple accounts entered the same round from a shared signal.',
      reason:
        'Two or more users placed entries in the same round with matching hashed IP/device evidence.',
      relatedType: 'ROUND',
      relatedId: input.roundId,
      ipHash: fingerprint.ipHash,
      userAgentHash: fingerprint.userAgentHash,
      deviceHash: fingerprint.deviceHash,
      metadata: {
        linkedUserIds: linkedUserIds.slice(0, 10),
        linkedEntryIds: evidence
          .map((item) => item.relatedId)
          .filter(Boolean)
          .slice(0, 10),
        evidenceCount: evidence.length,
        thresholdUsers: linkedUserIds.length >= 3 ? 3 : 2,
        reviewOnly: true,
      },
    });
  }

  private async evaluateMultiAccountPattern(
    input: FraudEvaluationInput & { entryId: string; roundId: string },
    fingerprint: RiskFingerprint,
  ) {
    if (!fingerprint.ipHash && !fingerprint.deviceHash) {
      return null;
    }

    const since = new Date(Date.now() - MULTI_ACCOUNT_WINDOW_MS);
    const evidence = await this.prisma.riskSignal.findMany({
      where: {
        createdAt: { gte: since },
        OR: [
          fingerprint.ipHash ? { ipHash: fingerprint.ipHash } : undefined,
          fingerprint.deviceHash
            ? { deviceHash: fingerprint.deviceHash }
            : undefined,
        ].filter(Boolean) as Prisma.RiskSignalWhereInput[],
      },
      select: {
        userId: true,
        roundId: true,
        relatedType: true,
        relatedId: true,
      },
      take: 100,
    });
    const linkedUserIds = [
      ...new Set(evidence.map((item) => item.userId).filter(Boolean)),
    ] as string[];
    const relatedRounds = [
      ...new Set(evidence.map((item) => item.roundId).filter(Boolean)),
    ] as string[];

    if (linkedUserIds.length < 3 || relatedRounds.length < 2) {
      return null;
    }

    return this.createOrUpdateRiskEvent({
      userId: input.userId,
      roomId: input.roomId,
      roundId: input.roundId,
      type: RiskEventType.MULTI_ACCOUNT_PATTERN,
      severity:
        linkedUserIds.length >= 5
          ? RiskEventSeverity.CRITICAL
          : RiskEventSeverity.HIGH,
      score: linkedUserIds.length >= 5 ? 88 : 74,
      summary: 'Linked account pattern requires admin review.',
      reason:
        'Multiple accounts share hashed network/device evidence across rounds.',
      relatedType: 'USER_GROUP',
      relatedId: fingerprint.deviceHash ?? fingerprint.ipHash ?? input.userId,
      ipHash: fingerprint.ipHash,
      userAgentHash: fingerprint.userAgentHash,
      deviceHash: fingerprint.deviceHash,
      metadata: {
        linkedUserIds: linkedUserIds.slice(0, 20),
        relatedRounds: relatedRounds.slice(0, 20),
        evidenceCount: evidence.length,
        reviewOnly: true,
      },
    });
  }

  private async recordRiskSignal(input: {
    userId?: string | null;
    type: string;
    action: string;
    roomId?: string | null;
    roundId?: string | null;
    relatedType?: string | null;
    relatedId?: string | null;
    fingerprint?: Partial<RiskFingerprint>;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.riskSignal.create({
      data: {
        userId: input.userId ?? null,
        type: input.type,
        action: input.action,
        roomId: input.roomId ?? null,
        roundId: input.roundId ?? null,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        ipHash: input.fingerprint?.ipHash ?? null,
        userAgentHash: input.fingerprint?.userAgentHash ?? null,
        deviceHash: input.fingerprint?.deviceHash ?? null,
        metadata: this.sanitizeMetadata(input.metadata),
      },
    });
  }

  private async countRecentFailedReceiptAttempts(userId: string) {
    return this.prisma.paymentVerificationAttempt.count({
      where: {
        depositIntent: { userId },
        createdAt: {
          gte: new Date(Date.now() - MANY_FAILED_RECEIPT_WINDOW_MS),
        },
        status: {
          in: ['REJECTED', 'FETCH_FAILED', 'PARSE_FAILED', 'NEEDS_MANUAL_REVIEW'],
        },
      },
    });
  }

  private async incrementRapidEntryAttempt(key: string) {
    if (this.redisService?.isAvailable()) {
      const count = await this.redisService.incr(
        key,
        RAPID_ENTRY_ATTEMPT_WINDOW_MS,
      );

      if (typeof count === 'number') {
        return count;
      }
    }

    if (getApiEnv().APP_ENV === 'production') {
      return null;
    }

    return this.incrementRapidEntryAttemptInMemory(key);
  }

  private incrementRapidEntryAttemptInMemory(key: string) {
    const now = Date.now();
    const bucket = this.rapidEntryBuckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.rapidEntryBuckets.set(key, {
        count: 1,
        resetAt: now + RAPID_ENTRY_ATTEMPT_WINDOW_MS,
      });
      this.pruneRapidEntryBuckets(now);
      return 1;
    }

    bucket.count += 1;
    return bucket.count;
  }

  private pruneRapidEntryBuckets(now: number) {
    if (this.rapidEntryBuckets.size < 10_000) {
      return;
    }

    for (const [key, bucket] of this.rapidEntryBuckets) {
      if (bucket.resetAt <= now) {
        this.rapidEntryBuckets.delete(key);
      }
    }
  }

  private getRapidEntryKey(userId: string, roundId: string) {
    return `fraud:rapid-entry:${roundId}:${userId}`;
  }

  private async findOpenDuplicateRiskEvent(input: {
    type: RiskEventType;
    userId?: string | null;
    relatedType?: string | null;
    relatedId?: string | null;
    roomId?: string | null;
    roundId?: string | null;
  }) {
    const criteria = [
      input.relatedType && input.relatedId
        ? {
            relatedType: input.relatedType,
            relatedId: input.relatedId,
          }
        : undefined,
      input.userId && input.roundId
        ? { userId: input.userId, roundId: input.roundId }
        : undefined,
      input.userId && input.roomId
        ? { userId: input.userId, roomId: input.roomId }
        : undefined,
    ].filter(Boolean) as Prisma.RiskEventWhereInput[];

    if (criteria.length === 0) {
      return null;
    }

    return this.prisma.riskEvent.findFirst({
      where: {
        type: input.type,
        status: RiskEventStatus.OPEN,
        OR: criteria,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private hashSignal(value: string | null | undefined) {
    const normalized = value?.trim().toLowerCase();

    if (!normalized) {
      return null;
    }

    const env = getApiEnv();
    const secret =
      env.BETTER_AUTH_SECRET ??
      env.CSRF_SECRET ??
      'local-risk-fingerprint-secret';

    return createHmac('sha256', secret)
      .update(normalized)
      .digest('hex')
      .slice(0, 32);
  }

  private sanitizeMetadata(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) {
      return undefined;
    }

    return this.sanitizeJson(value) as Prisma.InputJsonValue;
  }

  private sanitizeJson(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => this.sanitizeJson(item));
    }

    if (value && typeof value === 'object') {
      const safe: Record<string, unknown> = {};

      for (const [key, nested] of Object.entries(value)) {
        if (this.isSensitiveMetadataKey(key)) {
          safe[key] = '[redacted]';
          continue;
        }

        safe[key] = this.sanitizeJson(nested);
      }

      return safe;
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'string') {
      if (value.length > 500) {
        return `${value.slice(0, 500)}...`;
      }

      if (value.includes('@')) {
        return this.maskEmail(value);
      }

      return this.maskPhoneLike(value);
    }

    return value ?? null;
  }

  private isSensitiveMetadataKey(key: string) {
    const normalized = key.toLowerCase();

    return SENSITIVE_METADATA_KEYS.some((sensitive) =>
      normalized.includes(sensitive.toLowerCase()),
    );
  }

  private mergeMetadata(
    existing: Prisma.JsonValue | null,
    next: Prisma.InputJsonValue | undefined,
  ): Prisma.InputJsonValue {
    const current =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? existing
        : {};
    const incoming =
      next && typeof next === 'object' && !Array.isArray(next) ? next : {};

    return {
      ...current,
      ...incoming,
      updatedEvidenceAt: new Date().toISOString(),
    };
  }

  private defaultSummary(type: RiskEventType) {
    return type.replaceAll('_', ' ').toLowerCase();
  }

  private maxSeverity(a: RiskEventSeverity, b: RiskEventSeverity) {
    return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
  }

  private severityFromScore(score: number): RiskEventSeverity {
    if (score >= 81) return RiskEventSeverity.CRITICAL;
    if (score >= 51) return RiskEventSeverity.HIGH;
    if (score >= 21) return RiskEventSeverity.MEDIUM;
    return RiskEventSeverity.LOW;
  }

  private clampScore(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private normalizeDestination(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const parts = [
      record.phone,
      record.phoneNumber,
      record.account,
      record.accountNumber,
      record.name,
    ]
      .filter((part): part is string => typeof part === 'string')
      .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
      .filter(Boolean);

    return parts.length > 0 ? parts.join('|') : null;
  }

  private maskEmail(value: string) {
    const [local, domain] = value.split('@');
    if (!domain) return value;
    return `${local.slice(0, 2)}***@${domain}`;
  }

  private maskPhoneLike(value: string) {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 7) {
      return value;
    }

    return `${value.slice(0, 3)}***${value.slice(-2)}`;
  }
}

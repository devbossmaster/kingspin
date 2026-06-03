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
  type RiskEvent,
} from '@kingspin/db';
import { PrismaService } from '../../prisma/prisma.service';
import { getApiEnv } from '../../config/api-env';
import { RedisService } from '../redis/redis.service';

export type FraudCheckName =
  | 'DUPLICATE_IP_BETTING'
  | 'SUSPICIOUS_REPEATED_WINS'
  | 'MULTI_ACCOUNT_PATTERN'
  | 'RAPID_ENTRY_ATTEMPTS';

export type FraudEvaluationInput = {
  userId: string;
  roomId?: string;
  roundId?: string;
  amount?: bigint;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

export type FraudEvaluationResult = {
  decision: 'ALLOW' | 'REVIEW' | 'BLOCK';
  findings: Array<{
    check: FraudCheckName;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  plannedChecks: Array<{
    check: FraudCheckName;
    status: 'TODO_SCHEMA_NEEDED' | 'TODO_SIGNAL_NEEDED';
    description: string;
  }>;
  evaluatedAt: string;
};

type FraudFinding = FraudEvaluationResult['findings'][number];

type LocalRapidEntryBucket = {
  count: number;
  resetAt: number;
};

const RAPID_ENTRY_ATTEMPT_WINDOW_MS = 15_000;
const RAPID_ENTRY_ATTEMPT_MAX = 4;

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
        status: 'TODO_SIGNAL_NEEDED',
        description:
          'Detect multiple accounts entering the same room/round from one IP address.',
      },
      {
        check: 'SUSPICIOUS_REPEATED_WINS',
        status: 'TODO_SCHEMA_NEEDED',
        description:
          'Compare winner frequency against entries, ticket share, room, and time window baselines.',
      },
      {
        check: 'MULTI_ACCOUNT_PATTERN',
        status: 'TODO_SCHEMA_NEEDED',
        description:
          'Correlate accounts by device, payment, network, behavioral timing, and shared identifiers.',
      },
    ];
  }

  getMigrationTodos() {
    return [
      'Add request/session/device signal capture before enabling meaningful fraud scoring.',
      'Add fraud_reviews table for findings, disposition, reviewer, and notes.',
      'Add fraud_events table for immutable risk signals tied to users, rooms, rounds, entries, and wallets.',
      'Keep non-rapid-entry fraud checks advisory until policy, appeals, and admin review workflows exist.',
    ];
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

  async createRiskEvent(input: {
    userId?: string | null;
    roomId?: string | null;
    roundId?: string | null;
    type: keyof typeof RiskEventType | RiskEventType;
    severity: keyof typeof RiskEventSeverity | RiskEventSeverity;
    metadata?: Prisma.InputJsonValue;
  }) {
    const event = await this.prisma.riskEvent.create({
      data: {
        userId: input.userId ?? null,
        roomId: input.roomId ?? null,
        roundId: input.roundId ?? null,
        type: input.type as RiskEventType,
        severity: input.severity as RiskEventSeverity,
        metadata: input.metadata,
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

  async reviewRiskEvent(id: string, adminId: string, status: RiskEventStatus) {
    if (
      status !== RiskEventStatus.REVIEWED &&
      status !== RiskEventStatus.DISMISSED &&
      status !== RiskEventStatus.ACTIONED
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
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
      reviewedByAdminId: event.reviewedByAdminId,
      reviewedAt: event.reviewedAt?.toISOString() ?? null,
    };
  }
}

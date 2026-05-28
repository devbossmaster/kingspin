import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  Prisma,
  RiskEventSeverity,
  RiskEventStatus,
  RiskEventType,
  type RiskEvent,
} from "@kingspin/db";
import { PrismaService } from "../../prisma/prisma.service";

export type FraudCheckName =
  | "DUPLICATE_IP_BETTING"
  | "SUSPICIOUS_REPEATED_WINS"
  | "MULTI_ACCOUNT_PATTERN"
  | "RAPID_ENTRY_ATTEMPTS";

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
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  findings: Array<{
    check: FraudCheckName;
    severity: "LOW" | "MEDIUM" | "HIGH";
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  plannedChecks: Array<{
    check: FraudCheckName;
    status: "TODO_SCHEMA_NEEDED" | "TODO_SIGNAL_NEEDED";
    description: string;
  }>;
  evaluatedAt: string;
};

@Injectable()
export class FraudService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluateEntryAttempt(
    _input: FraudEvaluationInput,
  ): Promise<FraudEvaluationResult> {
    // TODO(fraud): wire this into entry placement as a non-authoritative
    // review signal once request/device/session history tables exist. This
    // skeleton must not block the current play-money vertical slice.
    return {
      decision: "ALLOW",
      findings: [],
      plannedChecks: this.getPlannedChecks(),
      evaluatedAt: new Date().toISOString(),
    };
  }

  getPlannedChecks(): FraudEvaluationResult["plannedChecks"] {
    return [
      {
        check: "DUPLICATE_IP_BETTING",
        status: "TODO_SIGNAL_NEEDED",
        description:
          "Detect multiple accounts entering the same room/round from one IP address.",
      },
      {
        check: "SUSPICIOUS_REPEATED_WINS",
        status: "TODO_SCHEMA_NEEDED",
        description:
          "Compare winner frequency against entries, ticket share, room, and time window baselines.",
      },
      {
        check: "MULTI_ACCOUNT_PATTERN",
        status: "TODO_SCHEMA_NEEDED",
        description:
          "Correlate accounts by device, payment, network, behavioral timing, and shared identifiers.",
      },
      {
        check: "RAPID_ENTRY_ATTEMPTS",
        status: "TODO_SIGNAL_NEEDED",
        description:
          "Flag excessive entry attempts, retries, or failed idempotency submissions in short windows.",
      },
    ];
  }

  getMigrationTodos() {
    return [
      "Add request/session/device signal capture before enabling meaningful fraud scoring.",
      "Add fraud_reviews table for findings, disposition, reviewer, and notes.",
      "Add fraud_events table for immutable risk signals tied to users, rooms, rounds, entries, and wallets.",
      "Keep fraud checks advisory until policy, appeals, and admin review workflows exist.",
    ];
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

  async listRiskEvents(filters: {
    status?: RiskEventStatus;
    severity?: RiskEventSeverity;
    userId?: string;
    take?: number;
  } = {}) {
    const take = Math.max(1, Math.min(filters.take ?? 50, 200));
    const events = await this.prisma.riskEvent.findMany({
      where: {
        status: filters.status,
        severity: filters.severity,
        userId: filters.userId,
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    return events.map((event) => this.toRiskEventSnapshot(event));
  }

  async reviewRiskEvent(
    id: string,
    adminId: string,
    status: RiskEventStatus,
  ) {
    if (
      status !== RiskEventStatus.REVIEWED &&
      status !== RiskEventStatus.DISMISSED &&
      status !== RiskEventStatus.ACTIONED
    ) {
      throw new BadRequestException("Invalid risk event review status.");
    }

    const existing = await this.prisma.riskEvent.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException("Risk event not found.");
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

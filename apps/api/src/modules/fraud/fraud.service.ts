import { Injectable } from "@nestjs/common";

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
}

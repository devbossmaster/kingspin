import { FraudService } from "./fraud.service";

describe("FraudService", () => {
  it("returns an allow decision while checks are skeleton-only", async () => {
    const service = new FraudService({} as never);

    const result = await service.evaluateEntryAttempt({
      userId: "user-1",
      roomId: "room-1",
      roundId: "round-1",
      amount: 1_000n,
      ipAddress: "127.0.0.1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        decision: "ALLOW",
        findings: [],
        plannedChecks: expect.arrayContaining([
          expect.objectContaining({ check: "DUPLICATE_IP_BETTING" }),
          expect.objectContaining({ check: "SUSPICIOUS_REPEATED_WINS" }),
          expect.objectContaining({ check: "MULTI_ACCOUNT_PATTERN" }),
          expect.objectContaining({ check: "RAPID_ENTRY_ATTEMPTS" }),
        ]),
      }),
    );
  });

  it("creates risk events for admin review without auto-banning", async () => {
    const now = new Date("2026-05-28T12:00:00.000Z");
    const prisma = {
      riskEvent: {
        create: jest.fn().mockResolvedValue({
          id: "risk-1",
          userId: "user-1",
          roomId: "room-1",
          roundId: null,
          type: "IDEMPOTENCY_MISMATCH",
          severity: "HIGH",
          status: "OPEN",
          metadata: { idempotencyKey: "key-1" },
          createdAt: now,
          reviewedByAdminId: null,
          reviewedAt: null,
        }),
      },
    };
    const service = new FraudService(prisma as never);

    const event = await service.createRiskEvent({
      userId: "user-1",
      roomId: "room-1",
      type: "IDEMPOTENCY_MISMATCH",
      severity: "HIGH",
      metadata: { idempotencyKey: "key-1" },
    });

    expect(event.status).toBe("OPEN");
    expect(event.type).toBe("IDEMPOTENCY_MISMATCH");
    expect(prisma.riskEvent.create).toHaveBeenCalledTimes(1);
  });
});

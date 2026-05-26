import { FraudService } from "./fraud.service";

describe("FraudService", () => {
  it("returns an allow decision while checks are skeleton-only", async () => {
    const service = new FraudService();

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
});

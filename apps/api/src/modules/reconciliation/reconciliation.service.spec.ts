import { LedgerEntryDirection, WalletAccountType } from "@kingspin/db";
import { ReconciliationService } from "./reconciliation.service";

describe("ReconciliationService", () => {
  it("reports no drift when wallet snapshot matches ledger sum", async () => {
    const prisma = {
      walletAccount: {
        findUnique: jest.fn().mockResolvedValue({
          id: "wallet-1",
          userId: "user-1",
          type: WalletAccountType.MAIN,
          balanceSnapshot: 7_000n,
          ledgerEntries: [
            {
              direction: LedgerEntryDirection.CREDIT,
              amount: 10_000n,
            },
            {
              direction: LedgerEntryDirection.DEBIT,
              amount: 3_000n,
            },
          ],
        }),
      },
    };
    const service = new ReconciliationService(prisma as any);

    const result = await service.reconcileWallet("wallet-1");

    expect(result).toEqual(
      expect.objectContaining({
        walletAccountId: "wallet-1",
        balanceSnapshot: "7000",
        ledgerBalance: "7000",
        driftAmount: "0",
        hasDrift: false,
      }),
    );
  });

  it("reports drift without auto-correcting wallet balances", async () => {
    const update = jest.fn();
    const prisma = {
      walletAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "wallet-1",
            userId: "user-1",
            type: WalletAccountType.MAIN,
            balanceSnapshot: 8_000n,
            ledgerEntries: [
              {
                direction: LedgerEntryDirection.CREDIT,
                amount: 10_000n,
              },
              {
                direction: LedgerEntryDirection.DEBIT,
                amount: 3_000n,
              },
            ],
          },
        ]),
        update,
      },
    };
    const service = new ReconciliationService(prisma as any);

    const result = await service.scanWallets({ onlyDrift: true });

    expect(result).toEqual(
      expect.objectContaining({
        scannedWalletCount: 1,
        driftCount: 1,
        autoCorrected: false,
        results: [
          expect.objectContaining({
            walletAccountId: "wallet-1",
            ledgerBalance: "7000",
            driftAmount: "1000",
            hasDrift: true,
          }),
        ],
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });
});

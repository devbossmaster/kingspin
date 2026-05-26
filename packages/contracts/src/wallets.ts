import { z } from "zod";

const BigIntStringSchema = z.string().regex(/^\d+$/);

export const WalletAccountTypeSchema = z.enum(["MAIN", "BONUS", "HOUSE"]);
export const LedgerDirectionSchema = z.enum(["CREDIT", "DEBIT"]);

export const DevCreditWalletSchema = z.object({
  userId: z.string().min(1).optional(),
  playerKey: z.string().min(1).optional(),
  amount: z.number().int().positive(),
  reason: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
});

export const WalletSnapshotSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  type: WalletAccountTypeSchema,
  balanceSnapshot: BigIntStringSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const LedgerEntrySnapshotSchema = z.object({
  id: z.string(),
  walletAccountId: z.string(),
  direction: LedgerDirectionSchema,
  amount: BigIntStringSchema,
  balanceAfterSnapshot: BigIntStringSchema.nullable(),
  createdAt: z.string(),
});

export type DevCreditWalletInput = z.infer<typeof DevCreditWalletSchema>;
export type WalletSnapshot = z.infer<typeof WalletSnapshotSchema>;
export type LedgerEntrySnapshot = z.infer<typeof LedgerEntrySnapshotSchema>;

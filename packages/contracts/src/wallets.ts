import { z } from "zod";
import { BigIntStringSchema, IsoDateStringSchema } from "./common";

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
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});

export const CurrentUserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    email: z.string().email().optional(),
    fullName: z.string().nullable().optional(),
    phoneNumber: z.string().optional(),
    role: z.string().optional(),
    emailVerified: z.boolean().optional(),
  })
  .strict();

export const MeWalletSchema = z
  .object({
    user: CurrentUserSchema,
    wallet: WalletSnapshotSchema,
  })
  .strict();

export const LedgerEntrySnapshotSchema = z.object({
  id: z.string(),
  walletAccountId: z.string(),
  direction: LedgerDirectionSchema,
  amount: BigIntStringSchema,
  balanceAfterSnapshot: BigIntStringSchema.nullable(),
  createdAt: IsoDateStringSchema,
});

export const LedgerTransactionSnapshotSchema = z.object({
  id: z.string(),
  type: z.string(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  idempotencyKey: z.string(),
  metadata: z.unknown().nullable().optional(),
  createdAt: IsoDateStringSchema,
  entries: z.array(LedgerEntrySnapshotSchema),
});

export type DevCreditWalletInput = z.infer<typeof DevCreditWalletSchema>;
export type CurrentUser = z.infer<typeof CurrentUserSchema>;
export type MeWallet = z.infer<typeof MeWalletSchema>;
export type WalletSnapshot = z.infer<typeof WalletSnapshotSchema>;
export type LedgerEntrySnapshot = z.infer<typeof LedgerEntrySnapshotSchema>;
export type LedgerTransactionSnapshot = z.infer<
  typeof LedgerTransactionSnapshotSchema
>;

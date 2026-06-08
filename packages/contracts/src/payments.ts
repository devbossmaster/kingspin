import { z } from "zod";
import { BigIntStringSchema, IsoDateStringSchema } from "./common";

export const PaymentProviderSchema = z.enum([
  "MANUAL",
  "MOCK",
  "TELEBIRR_RECEIPT",
  "TELEBIRR_OFFICIAL",
  "MANUAL_BANK",
  "NOWPAYMENTS",
  "CHAPA",
  "STRIPE",
  "CUSTOM",
]);

export const DepositStatusSchema = z.enum([
  "PENDING",
  "VERIFYING",
  "VERIFIED",
  "CREDITED",
  "REJECTED",
  "NEEDS_MANUAL_REVIEW",
  "CONFIRMED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
]);

export const WithdrawalStatusSchema = z.enum([
  "PENDING_REVIEW",
  "APPROVED",
  "PROCESSING",
  "COMPLETED",
  "PAID",
  "REJECTED",
  "FAILED",
  "CANCELLED",
]);

const DecimalAmountStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "amount must be a positive decimal string");

export const CreateDepositSchema = z
  .object({
    provider: PaymentProviderSchema.default("MOCK"),
    amount: z.union([z.number().int().positive(), DecimalAmountStringSchema]),
    currency: z.string().min(1).max(12).default("COIN"),
    idempotencyKey: z.string().min(1).max(200).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const SubmitTelebirrReceiptSchema = z
  .object({
    receiptInput: z.string().trim().min(4).max(4000),
  })
  .strict();

export const CreateWithdrawalSchema = z
  .object({
    provider: PaymentProviderSchema.default("MANUAL"),
    amount: z.number().int().positive(),
    currency: z.string().min(1).max(12).default("COIN"),
    destination: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().min(1).max(200),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const DepositSnapshotSchema = z.object({
  id: z.string(),
  userId: z.string(),
  provider: PaymentProviderSchema,
  providerReference: z.string().nullable(),
  amount: BigIntStringSchema,
  expectedAmount: z.string().optional(),
  currency: z.string(),
  status: DepositStatusSchema,
  idempotencyKey: z.string().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  confirmedAt: IsoDateStringSchema.nullable(),
  expiresAt: IsoDateStringSchema.nullable().optional(),
  receiptNo: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  reviewReason: z.string().nullable().optional(),
});

export const WithdrawalSnapshotSchema = z.object({
  id: z.string(),
  userId: z.string(),
  walletAccountId: z.string(),
  provider: PaymentProviderSchema,
  amount: BigIntStringSchema,
  currency: z.string(),
  status: WithdrawalStatusSchema,
  providerReference: z.string().nullable(),
  destinationDisplay: z.string().nullable().optional(),
  requestedAt: IsoDateStringSchema,
  reviewedAt: IsoDateStringSchema.nullable(),
  reviewedByAdminId: z.string().nullable(),
  paidAt: IsoDateStringSchema.nullable(),
  rejectionReason: z.string().nullable(),
  idempotencyKey: z.string(),
  metadata: z.unknown().nullable().optional(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});

export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;
export type DepositStatus = z.infer<typeof DepositStatusSchema>;
export type WithdrawalStatus = z.infer<typeof WithdrawalStatusSchema>;
export type CreateDepositInput = z.infer<typeof CreateDepositSchema>;
export type SubmitTelebirrReceiptInput = z.infer<
  typeof SubmitTelebirrReceiptSchema
>;
export type CreateWithdrawalInput = z.infer<typeof CreateWithdrawalSchema>;
export type DepositSnapshot = z.infer<typeof DepositSnapshotSchema>;
export type WithdrawalSnapshot = z.infer<typeof WithdrawalSnapshotSchema>;

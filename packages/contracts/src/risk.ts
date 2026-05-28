import { z } from "zod";
import { IsoDateStringSchema } from "./common";

export const RiskEventTypeSchema = z.enum([
  "IDEMPOTENCY_MISMATCH",
  "ENTRY_RATE_LIMIT_HIT",
  "INSUFFICIENT_BALANCE_SPAM",
  "DUPLICATE_IP_DEVICE",
  "DEPOSIT_WEBHOOK_MISMATCH",
  "WITHDRAWAL_AMOUNT_SPIKE",
  "FAST_DEPOSIT_WITHDRAWAL",
  "ABNORMAL_WIN_PATTERN",
  "ADMIN_ROUND_INTERVENTION",
  "PAYMENT_FAILURE_PATTERN",
  "MANUAL_FLAG",
]);

export const RiskEventSeveritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const RiskEventStatusSchema = z.enum([
  "OPEN",
  "REVIEWED",
  "DISMISSED",
  "ACTIONED",
]);

export const RiskEventSnapshotSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  roomId: z.string().nullable(),
  roundId: z.string().nullable(),
  type: RiskEventTypeSchema,
  severity: RiskEventSeveritySchema,
  status: RiskEventStatusSchema,
  metadata: z.unknown().nullable().optional(),
  createdAt: IsoDateStringSchema,
  reviewedByAdminId: z.string().nullable(),
  reviewedAt: IsoDateStringSchema.nullable(),
});

export type RiskEventType = z.infer<typeof RiskEventTypeSchema>;
export type RiskEventSeverity = z.infer<typeof RiskEventSeveritySchema>;
export type RiskEventStatus = z.infer<typeof RiskEventStatusSchema>;
export type RiskEventSnapshot = z.infer<typeof RiskEventSnapshotSchema>;

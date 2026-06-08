import { z } from "zod";
import {
  BigIntStringSchema,
  IsoDateStringSchema,
  NullableIsoDateStringSchema,
} from "./common";
import { EntryWithPlayerSnapshotSchema } from "./entries";

export const RoundStatusSchema = z.enum([
  "OPEN",
  "LOCKED",
  "DRAWING",
  "SPINNING",
  "SETTLING",
  "COMPLETED",
  "CANCELLED",
]);

export const PublicRoundPhaseSchema = z.enum([
  "ENTRY_OPEN",
  "RANDOMIZING",
  "SPINNING",
  "RESULT",
]);

export const PublicRoundResultReasonSchema = z
  .enum(["WINNER", "SKIPPED_EMPTY", "REFUNDED_SINGLE"])
  .nullable();

export const RoundSnapshotSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  roundNumber: z.number().int().positive(),
  status: RoundStatusSchema,
  totalEntryAmount: BigIntStringSchema,
  houseFeeAmount: BigIntStringSchema,
  payoutAmount: BigIntStringSchema,
  grossPoolAmount: BigIntStringSchema,
  platformFeeAmount: BigIntStringSchema,
  netPrizeAmount: BigIntStringSchema,
  platformFeeBps: z.number().int().min(0).max(10_000),
  openedAt: IsoDateStringSchema,
  locksAt: NullableIsoDateStringSchema,
  lockedAt: NullableIsoDateStringSchema,
  drawingAt: NullableIsoDateStringSchema,
  spinningAt: NullableIsoDateStringSchema,
  settlingAt: NullableIsoDateStringSchema,
  completedAt: NullableIsoDateStringSchema,
  cancelledAt: NullableIsoDateStringSchema,
  serverSeedHash: z.string().nullable(),
  fairnessAlgorithm: z.string().nullable(),
  entriesHash: z.string().nullable(),
  winningTicket: BigIntStringSchema.nullable(),
  winnerUserId: z.string().nullable(),
  winnerEntryId: z.string().nullable(),
  spinAngle: z.number().nullable(),
});

export const LiveRoundSnapshotSchema = RoundSnapshotSchema.extend({
  msUntilLock: z.number().int().nonnegative(),
  phase: PublicRoundPhaseSchema,
  phaseLabel: z.string(),
  msUntilPhaseEnd: z.number().int().nonnegative(),
  msUntilNextRound: z.number().int().nonnegative().nullable(),
  resultReason: PublicRoundResultReasonSchema,
});

export const FairnessProofSchema = z.object({
  algorithm: z.string().nullable(),
  algorithmMatches: z.boolean(),
  serverSeedHash: z.string().nullable(),
  serverSeedReveal: z.string().nullable(),
  recomputedServerSeedHash: z.string().nullable(),
  seedHashMatches: z.boolean(),
  entriesHash: z.string().nullable(),
  recomputedEntriesHash: z.string().nullable(),
  entriesHashMatches: z.boolean(),
  totalEntryAmount: BigIntStringSchema,
  winningTicket: BigIntStringSchema.nullable(),
  drawInput: z.string().nullable(),
  drawHash: z.string().nullable(),
  recomputedDrawHash: z.string().nullable(),
  drawHashMatches: z.boolean(),
  nonceUsed: z.number().int().nonnegative().nullable(),
  recomputedWinningTicket: BigIntStringSchema.nullable(),
  winningTicketMatches: z.boolean(),
  winnerTicketInsideRange: z.boolean(),
  rangesCoverTotal: z.boolean(),
  rangeError: z.string().nullable(),
  verificationPassed: z.boolean(),
});

export const LatestRoundResultSchema = z.object({
  round: RoundSnapshotSchema,
  serverSeedReveal: z.string().nullable(),
  fairness: FairnessProofSchema,
  winnerEntry: EntryWithPlayerSnapshotSchema.nullable(),
  entries: z.array(EntryWithPlayerSnapshotSchema),
});

export type RoundStatus = z.infer<typeof RoundStatusSchema>;
export type PublicRoundPhase = z.infer<typeof PublicRoundPhaseSchema>;
export type PublicRoundResultReason = z.infer<
  typeof PublicRoundResultReasonSchema
>;
export type RoundSnapshot = z.infer<typeof RoundSnapshotSchema>;
export type LiveRoundSnapshot = z.infer<typeof LiveRoundSnapshotSchema>;
export type FairnessProof = z.infer<typeof FairnessProofSchema>;
export type LatestRoundResult = z.infer<typeof LatestRoundResultSchema>;

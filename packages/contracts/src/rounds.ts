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
  openedAt: IsoDateStringSchema,
  locksAt: NullableIsoDateStringSchema,
  lockedAt: NullableIsoDateStringSchema,
  drawingAt: NullableIsoDateStringSchema,
  spinningAt: NullableIsoDateStringSchema,
  settlingAt: NullableIsoDateStringSchema,
  completedAt: NullableIsoDateStringSchema,
  cancelledAt: NullableIsoDateStringSchema,
  serverSeedHash: z.string().nullable(),
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
  serverSeedHash: z.string().nullable(),
  recomputedServerSeedHash: z.string().nullable(),
  seedHashMatches: z.boolean(),
  drawInput: z.string().nullable(),
  drawHash: z.string().nullable(),
  recomputedWinningTicket: BigIntStringSchema.nullable(),
  winningTicketMatches: z.boolean(),
  winnerTicketInsideRange: z.boolean(),
  rangesCoverTotal: z.boolean(),
  rangeError: z.string().nullable(),
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

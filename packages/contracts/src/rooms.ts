import { z } from "zod";
import { BigIntStringSchema, IsoDateStringSchema } from "./common";
import { EntryWithPlayerSnapshotSchema } from "./entries";
import {
  LiveRoundSnapshotSchema,
  PublicRoundPhaseSchema,
  PublicRoundResultReasonSchema,
  RoundStatusSchema,
} from "./rounds";

export const RoomStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "MAINTENANCE",
  "CLOSED",
  "ARCHIVED",
]);

export const GameModeSchema = z.enum([
  "FLEXIBLE_PROPORTIONAL",
  "FIXED_EQUAL_CHANCE",
]);

export const CreateRoomSchema = z.object({
  categoryId: z.string().min(1),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120).optional(),
  gameMode: GameModeSchema.optional(),
  fixedEntryAmount: z.number().int().positive().optional(),
  isPermanent: z.boolean().optional(),
  maxPlayers: z.number().int().positive().optional(),
  roundDurationMs: z.number().int().positive().optional(),
});

export const RoomSnapshotSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  code: z.string(),
  name: z.string().nullable(),
  status: RoomStatusSchema,
  gameMode: GameModeSchema,
  fixedEntryAmount: BigIntStringSchema.nullable(),
  isPermanent: z.boolean(),
  maxPlayers: z.number().int().positive(),
  roundDurationMs: z.number().int().positive(),
  activatedAt: IsoDateStringSchema.nullable(),
});

export const CategorySnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  minEntryAmount: BigIntStringSchema,
  maxEntryAmount: BigIntStringSchema,
  maxPlayers: z.number().int().positive(),
  roundDurationMs: z.number().int().positive(),
});

export const RoomLiveStateSchema = z.object({
  serverNow: IsoDateStringSchema,
  room: RoomSnapshotSchema,
  category: CategorySnapshotSchema,
  currentRound: LiveRoundSnapshotSchema.nullable(),
  entries: z.array(EntryWithPlayerSnapshotSchema),
});

export const RoomLiveSummaryRoundSchema = z.object({
  id: z.string(),
  roundNumber: z.number().int().positive(),
  status: RoundStatusSchema,
  phase: PublicRoundPhaseSchema,
  phaseLabel: z.string(),
  locksAt: IsoDateStringSchema.nullable(),
  msUntilLock: z.number().int().nonnegative(),
  msUntilPhaseEnd: z.number().int().nonnegative(),
  msUntilNextRound: z.number().int().nonnegative().nullable(),
  resultReason: PublicRoundResultReasonSchema,
  playerCount: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  totalEntryAmount: BigIntStringSchema,
  payoutAmount: BigIntStringSchema,
  totalPool: BigIntStringSchema,
  winnerEntryId: z.string().nullable().optional(),
});

export const RoomLiveSummarySchema = RoomSnapshotSchema.extend({
  name: z.string().nullable(),
  categorySlug: z.string(),
  categoryName: z.string(),
  serverNow: IsoDateStringSchema,
  receivedAtMs: z.number().optional(),
  currentRound: RoomLiveSummaryRoundSchema.nullable(),
});

export type RoomStatus = z.infer<typeof RoomStatusSchema>;
export type GameMode = z.infer<typeof GameModeSchema>;
export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export type CategorySnapshot = z.infer<typeof CategorySnapshotSchema>;
export type RoomLiveState = z.infer<typeof RoomLiveStateSchema>;
export type RoomLiveSummary = z.infer<typeof RoomLiveSummarySchema>;
export type RoomLiveSummaryRound = z.infer<typeof RoomLiveSummaryRoundSchema>;

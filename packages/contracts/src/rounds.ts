import { z } from "zod";

export const RoundStatusSchema = z.enum([
  "OPEN",
  "LOCKED",
  "DRAWING",
  "SPINNING",
  "SETTLING",
  "COMPLETED",
  "CANCELLED",
]);

const BigIntStringSchema = z.string().regex(/^\d+$/);

export const RoundSnapshotSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  roundNumber: z.number().int().positive(),
  status: RoundStatusSchema,
  totalEntryAmount: BigIntStringSchema,
  houseFeeAmount: BigIntStringSchema,
  payoutAmount: BigIntStringSchema,
  openedAt: z.string(),
  locksAt: z.string().nullable(),
  lockedAt: z.string().nullable(),
  drawingAt: z.string().nullable(),
  spinningAt: z.string().nullable(),
  settlingAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  serverSeedHash: z.string().nullable(),
  winningTicket: BigIntStringSchema.nullable(),
  winnerUserId: z.string().nullable(),
  winnerEntryId: z.string().nullable(),
  spinAngle: z.number().nullable(),
});

export const RoomStateSchema = z.object({
  room: z.object({
    id: z.string(),
    categoryId: z.string(),
    code: z.string(),
    name: z.string().nullable(),
    status: z.string(),
    isPermanent: z.boolean(),
    maxPlayers: z.number().int(),
    roundDurationMs: z.number().int(),
    activatedAt: z.string().nullable(),
  }),
  category: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    minEntryAmount: BigIntStringSchema,
    maxEntryAmount: BigIntStringSchema,
    maxPlayers: z.number().int(),
    roundDurationMs: z.number().int(),
  }),
  currentRound: RoundSnapshotSchema.nullable(),
});

export const PlaceEntrySchema = z.object({
  roomId: z.string().min(1),
  roundId: z.string().min(1),
  amount: z.number().int().positive(),
});

export type RoundStatus = z.infer<typeof RoundStatusSchema>;
export type RoundSnapshot = z.infer<typeof RoundSnapshotSchema>;
export type RoomState = z.infer<typeof RoomStateSchema>;
export type PlaceEntryInput = z.infer<typeof PlaceEntrySchema>;

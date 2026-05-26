import { z } from "zod";
import { BigIntStringSchema, IsoDateStringSchema } from "./common";
import { EntryWithPlayerSnapshotSchema } from "./entries";
import { LiveRoundSnapshotSchema } from "./rounds";

export const RoomStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "MAINTENANCE",
  "CLOSED",
  "ARCHIVED",
]);

export const CreateRoomSchema = z.object({
  categoryId: z.string().min(1),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120).optional(),
  isPermanent: z.boolean().optional(),
  maxPlayers: z.number().int().positive().optional(),
  roundDurationMs: z.number().int().positive().optional(),
});

export const RoomSnapshotSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  code: z.string(),
  name: z.string(),
  status: RoomStatusSchema,
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

export type RoomStatus = z.infer<typeof RoomStatusSchema>;
export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export type CategorySnapshot = z.infer<typeof CategorySnapshotSchema>;
export type RoomLiveState = z.infer<typeof RoomLiveStateSchema>;

import { z } from "zod";

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
  name: z.string().max(80).optional(),
  maxPlayers: z.number().int().min(2).max(50).default(24),
  roundDurationMs: z.number().int().min(15000).max(120000).default(45000),
});

export const RoomSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  code: z.string(),
  name: z.string().nullable().optional(),
  status: RoomStatusSchema,
  maxPlayers: z.number().int(),
  roundDurationMs: z.number().int(),
});

export type RoomStatus = z.infer<typeof RoomStatusSchema>;
export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;
export type Room = z.infer<typeof RoomSchema>;

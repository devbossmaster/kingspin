import { z } from "zod";

const BigIntStringSchema = z.string().regex(/^\d+$/);

export const DevPlaceEntrySchema = z.object({
  userId: z.string().min(1).optional(),
  playerKey: z.string().min(1).optional(),

  // Added amount.
  // If the user already has an entry, this increases their existing entry.
  amount: z.number().int().positive(),

  // Strongly recommended for retry safety.
  idempotencyKey: z.string().min(1).optional(),
});

export const EntrySnapshotSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  userId: z.string(),
  amount: BigIntStringSchema,
  ticketStart: BigIntStringSchema.nullable(),
  ticketEnd: BigIntStringSchema.nullable(),
  isWinner: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DevPlaceEntryInput = z.infer<typeof DevPlaceEntrySchema>;
export type EntrySnapshot = z.infer<typeof EntrySnapshotSchema>;

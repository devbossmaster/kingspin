import { z } from "zod";
import {
  BigIntStringSchema,
  IsoDateStringSchema,
  PlayerPublicSchema,
} from "./common";

export const DevPlaceEntrySchema = z
  .object({
    userId: z.string().min(1).optional(),
    playerKey: z.string().min(1).optional(),
    amount: z.number().int().positive(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .refine((value) => value.userId || value.playerKey, {
    message: "Either userId or playerKey is required.",
    path: ["playerKey"],
  });

export const PlaceEntrySchema = z.object({
  amount: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export const EntrySnapshotSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  userId: z.string(),
  amount: BigIntStringSchema,
  ticketStart: BigIntStringSchema.nullable(),
  ticketEnd: BigIntStringSchema.nullable(),
  isWinner: z.boolean(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});

export const EntryWithPlayerSnapshotSchema = EntrySnapshotSchema.extend({
  player: PlayerPublicSchema.nullable().optional(),
});

export type DevPlaceEntryInput = z.infer<typeof DevPlaceEntrySchema>;
export type PlaceEntryInput = z.infer<typeof PlaceEntrySchema>;
export type EntrySnapshot = z.infer<typeof EntrySnapshotSchema>;
export type EntryWithPlayerSnapshot = z.infer<
  typeof EntryWithPlayerSnapshotSchema
>;

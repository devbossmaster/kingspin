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

export const PlaceEntrySchema = z.object({
  roomId: z.string().min(1),
  roundId: z.string().min(1),
  amount: z.number().int().positive(),
});

export type RoundStatus = z.infer<typeof RoundStatusSchema>;
export type PlaceEntryInput = z.infer<typeof PlaceEntrySchema>;

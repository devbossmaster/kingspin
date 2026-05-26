import { z } from "zod";

export const BigIntStringSchema = z.string().regex(/^\d+$/);

export const IsoDateStringSchema = z.string().min(1);

export const NullableIsoDateStringSchema = IsoDateStringSchema.nullable();

export const PlayerPublicSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string().nullable().optional(),
});

export type BigIntString = z.infer<typeof BigIntStringSchema>;
export type IsoDateString = z.infer<typeof IsoDateStringSchema>;
export type PlayerPublic = z.infer<typeof PlayerPublicSchema>;

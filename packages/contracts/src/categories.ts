import { z } from "zod";

export const CategorySlugSchema = z.enum([
  "pro-10-100",
  "pro-100-200",
  "pro-200-350",
  "fixed-10",
  "fixed-20",
  "fixed-50",
  "jemaw-1",
  "jemaw-2",
  "jemaw-3",
]);

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: CategorySlugSchema,
  minEntryAmount: z.number().int().positive(),
  maxEntryAmount: z.number().int().positive(),
  maxPlayers: z.number().int().positive(),
  isActive: z.boolean(),
});

export type Category = z.infer<typeof CategorySchema>;
export type CategorySlug = z.infer<typeof CategorySlugSchema>;

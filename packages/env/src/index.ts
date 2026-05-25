import { z } from "zod";

export const ApiEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  WEB_URL: z.string().url().default("http://localhost:3000"),
});

export function parseApiEnv(env: Record<string, string | undefined>) {
  return ApiEnvSchema.parse(env);
}

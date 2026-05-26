import { z } from "zod";

const BooleanStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off", ""].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean());

export const ApiEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_DEV_KEY: z.string().optional(),
  ALLOW_PUBLIC_DEV_ENTRY_ENDPOINT: BooleanStringSchema.default(false),
  ROUND_MACHINE_AUTO_START: BooleanStringSchema.optional(),
  SOCKET_REDIS_ADAPTER_ENABLED: BooleanStringSchema.default(false),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

export function parseApiEnv(env: Record<string, string | undefined>) {
  const parsed = ApiEnvSchema.parse(env);

  if (parsed.NODE_ENV === "production" && !parsed.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production.");
  }

  return parsed;
}

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

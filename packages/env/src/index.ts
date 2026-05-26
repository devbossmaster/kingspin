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

const OptionalStringSchema = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }

  return value;
}, z.string().min(1).optional());

const OptionalUrlSchema = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }

  return value;
}, z.string().url().optional());

const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const ApiEnvBaseSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: OptionalStringSchema,
    DIRECT_URL: OptionalStringSchema,
    WEB_URL: z.string().url().default("http://localhost:3000"),
    CORS_ORIGIN: OptionalUrlSchema,
    API_CORS_ORIGIN: OptionalUrlSchema,
    ADMIN_DEV_KEY: OptionalStringSchema,
    ROUND_MACHINE_AUTO_START: BooleanStringSchema.optional(),
    ENABLE_DEV_AUTH: BooleanStringSchema.default(false),
    ENABLE_REDIS: BooleanStringSchema.default(false),
    REDIS_URL: OptionalStringSchema,
    BETTER_AUTH_SECRET: OptionalStringSchema,
    BETTER_AUTH_URL: OptionalUrlSchema,
    RESEND_API_KEY: OptionalStringSchema,
    SENTRY_DSN: OptionalUrlSchema,
    LOG_LEVEL: LogLevelSchema.default("info"),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  })
  .passthrough()
  .transform((env) => ({
    ...env,
    API_CORS_ORIGIN: env.API_CORS_ORIGIN ?? env.CORS_ORIGIN ?? env.WEB_URL,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? env.WEB_URL,
  }));

export const ApiEnvSchema = ApiEnvBaseSchema.superRefine((env, context) => {
  if (env.ENABLE_REDIS && !env.REDIS_URL) {
    context.addIssue({
      code: "custom",
      path: ["REDIS_URL"],
      message: "REDIS_URL is required when ENABLE_REDIS=true.",
    });
  }

  if (env.NODE_ENV !== "production") {
    return;
  }

  if (!env.DATABASE_URL) {
    context.addIssue({
      code: "custom",
      path: ["DATABASE_URL"],
      message: "DATABASE_URL is required in production.",
    });
  }

  if (!env.BETTER_AUTH_SECRET) {
    context.addIssue({
      code: "custom",
      path: ["BETTER_AUTH_SECRET"],
      message: "BETTER_AUTH_SECRET is required in production.",
    });
  }

  if (env.ENABLE_DEV_AUTH) {
    context.addIssue({
      code: "custom",
      path: ["ENABLE_DEV_AUTH"],
      message: "ENABLE_DEV_AUTH must be disabled in production.",
    });
  }
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvValidationError";
  }
}

export function parseApiEnv(env: Record<string, string | undefined>): ApiEnv {
  const parsed = ApiEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new EnvValidationError(
      `Invalid API environment:\n${formatZodIssues(parsed.error.issues)}`,
    );
  }

  return parsed.data;
}

function formatZodIssues(issues: z.core.$ZodIssue[]) {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "env";

      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
}

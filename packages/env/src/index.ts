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
const AppEnvSchema = z.enum(["local", "staging", "production"]);

type AppEnv = z.infer<typeof AppEnvSchema>;

type EnvWithDeployment = {
  APP_ENV?: AppEnv;
  DEPLOY_ENV?: AppEnv;
  NODE_ENV?: "development" | "test" | "production";
};

function resolveAppEnv(env: EnvWithDeployment): AppEnv {
  return (
    env.APP_ENV ??
    env.DEPLOY_ENV ??
    (env.NODE_ENV === "production" ? "production" : "local")
  );
}

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

function isMarkedLocalPlaceholder(value: string | undefined) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  return (
    normalized.includes("placeholder") ||
    normalized.includes("replace") ||
    normalized.includes("example") ||
    normalized.includes("not-used") ||
    normalized.includes("not_used") ||
    normalized.includes("dummy") ||
    normalized.includes("fake") ||
    normalized.startsWith("local-") ||
    normalized.startsWith("local_")
  );
}

function isDeployedAppEnv(appEnv: AppEnv) {
  return appEnv !== "local";
}

function appEnvLabel(appEnv: AppEnv) {
  return appEnv === "production" ? "production" : "staging";
}

function requireDeployedUrl(
  context: z.core.$RefinementCtx,
  key: string,
  value: string | undefined,
  allowedProtocols: string[],
  appEnv: AppEnv,
) {
  const label = appEnvLabel(appEnv);

  if (!value) {
    context.addIssue({
      code: "custom",
      path: [key],
      message: `${key} is required in ${label}.`,
    });
    return;
  }

  const url = new URL(value);

  if (!allowedProtocols.includes(url.protocol)) {
    context.addIssue({
      code: "custom",
      path: [key],
      message: `${key} must use ${allowedProtocols.join(" or ")} in ${label}.`,
    });
  }

  if (isLocalHostname(url.hostname)) {
    context.addIssue({
      code: "custom",
      path: [key],
      message: `${key} must use a deployed origin in ${label}.`,
    });
  }
}

const ApiEnvBaseSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_ENV: AppEnvSchema.optional(),
    DEPLOY_ENV: AppEnvSchema.optional(),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: OptionalStringSchema,
    WEB_URL: z.string().url().default("http://localhost:3000"),
    CORS_ORIGIN: OptionalUrlSchema,
    API_CORS_ORIGIN: OptionalUrlSchema,
    ADMIN_DEV_KEY: OptionalStringSchema,
    ADMIN_DEV_CREDIT_MAX: z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .default(10_000),
    ROUND_MACHINE_AUTO_START: BooleanStringSchema.optional(),
    ENABLE_DEV_AUTH: BooleanStringSchema.default(false),
    ENABLE_LOCAL_DEV_AUTH: BooleanStringSchema.optional(),
    ENABLE_REDIS: BooleanStringSchema.default(false),
    REDIS_URL: OptionalStringSchema,
    PAYMENT_PROVIDER: z
      .enum(["MANUAL", "MOCK", "NOWPAYMENTS", "CHAPA", "STRIPE", "CUSTOM"])
      .default("MOCK"),
    BETTER_AUTH_SECRET: OptionalStringSchema,
    BETTER_AUTH_URL: OptionalUrlSchema,
    RESEND_API_KEY: OptionalStringSchema,
    RESEND_FROM_EMAIL: OptionalStringSchema,
    EMAIL_FROM: OptionalStringSchema,
    SENTRY_DSN: OptionalUrlSchema,
    LOG_LEVEL: LogLevelSchema.default("info"),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    TRUST_PROXY_HEADERS: BooleanStringSchema.default(false),
    CSRF_SECRET: OptionalStringSchema,
  })
  .passthrough()
  .transform((env) => ({
    ...env,
    APP_ENV: resolveAppEnv(env),
    API_CORS_ORIGIN: env.API_CORS_ORIGIN ?? env.CORS_ORIGIN ?? env.WEB_URL,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? env.WEB_URL,
    ENABLE_LOCAL_DEV_AUTH: env.ENABLE_LOCAL_DEV_AUTH ?? env.ENABLE_DEV_AUTH,
  }));

export const ApiEnvSchema = ApiEnvBaseSchema.superRefine((env, context) => {
  if (env.DEPLOY_ENV && env.APP_ENV !== env.DEPLOY_ENV) {
    context.addIssue({
      code: "custom",
      path: ["APP_ENV"],
      message: "APP_ENV and DEPLOY_ENV must match when both are set.",
    });
  }

  if (env.APP_ENV === "production" && env.ENABLE_REDIS && !env.REDIS_URL) {
    context.addIssue({
      code: "custom",
      path: ["REDIS_URL"],
      message: "REDIS_URL is required when ENABLE_REDIS=true in production.",
    });
  }

  if (env.APP_ENV === "production" && env.PAYMENT_PROVIDER === "MOCK") {
    context.addIssue({
      code: "custom",
      path: ["PAYMENT_PROVIDER"],
      message:
        "PAYMENT_PROVIDER=MOCK is local-only. Use MANUAL or a configured real adapter stub in production.",
    });
  }

  if (env.APP_ENV !== "local" && env.ADMIN_DEV_KEY) {
    context.addIssue({
      code: "custom",
      path: ["ADMIN_DEV_KEY"],
      message:
        "ADMIN_DEV_KEY is local-only. Remove it from staging/production and use Better Auth admin roles.",
    });
  }

  if (env.APP_ENV !== "local") {
    for (const [key, value] of [
      ["RESEND_API_KEY", env.RESEND_API_KEY],
      ["RESEND_FROM_EMAIL", env.RESEND_FROM_EMAIL],
      ["EMAIL_FROM", env.EMAIL_FROM],
    ] as const) {
      if (isMarkedLocalPlaceholder(value)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message:
            "Local Resend placeholders are only allowed when APP_ENV=local.",
        });
      }
    }
  }

  if (!isDeployedAppEnv(env.APP_ENV)) {
    return;
  }

  requireDeployedUrl(context, "WEB_URL", env.WEB_URL, ["https:"], env.APP_ENV);
  requireDeployedUrl(
    context,
    "API_CORS_ORIGIN",
    env.API_CORS_ORIGIN,
    ["https:"],
    env.APP_ENV,
  );
  requireDeployedUrl(
    context,
    "BETTER_AUTH_URL",
    env.BETTER_AUTH_URL,
    ["https:"],
    env.APP_ENV,
  );

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

  if (!env.RESEND_API_KEY) {
    context.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message:
        "RESEND_API_KEY is required in production for Better Auth email verification/reset delivery.",
    });
  }

  if (!env.RESEND_FROM_EMAIL && !env.EMAIL_FROM) {
    context.addIssue({
      code: "custom",
      path: ["RESEND_FROM_EMAIL"],
      message:
        "RESEND_FROM_EMAIL or EMAIL_FROM is required in production for auth emails.",
    });
  }

  if (env.APP_ENV === "production" && env.ENABLE_DEV_AUTH) {
    context.addIssue({
      code: "custom",
      path: ["ENABLE_DEV_AUTH"],
      message: "ENABLE_DEV_AUTH must be disabled in production.",
    });
  }
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

const WebEnvBaseSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_ENV: AppEnvSchema.optional(),
    DEPLOY_ENV: AppEnvSchema.optional(),
    DATABASE_URL: OptionalStringSchema,
    WEB_URL: z.string().url().default("http://localhost:3000"),
    BETTER_AUTH_URL: OptionalUrlSchema,
    BETTER_AUTH_SECRET: OptionalStringSchema,
    BETTER_AUTH_COOKIE_DOMAIN: OptionalStringSchema,
    NEXT_PUBLIC_WEB_URL: OptionalUrlSchema,
    NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
    NEXT_PUBLIC_SOCKET_URL: z
      .string()
      .url()
      .default("http://localhost:4000/game"),
    RESEND_API_KEY: OptionalStringSchema,
    RESEND_FROM_EMAIL: OptionalStringSchema,
    EMAIL_FROM: OptionalStringSchema,
    ENABLE_DEV_AUTH: BooleanStringSchema.default(false),
    LOG_LEVEL: LogLevelSchema.default("info"),
  })
  .passthrough()
  .transform((env) => ({
    ...env,
    APP_ENV: resolveAppEnv(env),
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? env.WEB_URL,
    NEXT_PUBLIC_WEB_URL: env.NEXT_PUBLIC_WEB_URL ?? env.WEB_URL,
  }));

export const WebEnvSchema = WebEnvBaseSchema.superRefine((env, context) => {
  if (env.DEPLOY_ENV && env.APP_ENV !== env.DEPLOY_ENV) {
    context.addIssue({
      code: "custom",
      path: ["APP_ENV"],
      message: "APP_ENV and DEPLOY_ENV must match when both are set.",
    });
  }

  if (env.APP_ENV !== "local") {
    for (const [key, value] of [
      ["RESEND_API_KEY", env.RESEND_API_KEY],
      ["RESEND_FROM_EMAIL", env.RESEND_FROM_EMAIL],
      ["EMAIL_FROM", env.EMAIL_FROM],
    ] as const) {
      if (isMarkedLocalPlaceholder(value)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message:
            "Local Resend placeholders are only allowed when APP_ENV=local.",
        });
      }
    }
  }

  if (!isDeployedAppEnv(env.APP_ENV)) {
    return;
  }

  if (!env.DATABASE_URL) {
    context.addIssue({
      code: "custom",
      path: ["DATABASE_URL"],
      message: "DATABASE_URL is required in production.",
    });
  }

  requireDeployedUrl(context, "WEB_URL", env.WEB_URL, ["https:"], env.APP_ENV);
  requireDeployedUrl(
    context,
    "BETTER_AUTH_URL",
    env.BETTER_AUTH_URL,
    ["https:"],
    env.APP_ENV,
  );
  requireDeployedUrl(
    context,
    "NEXT_PUBLIC_API_URL",
    env.NEXT_PUBLIC_API_URL,
    ["https:"],
    env.APP_ENV,
  );
  requireDeployedUrl(
    context,
    "NEXT_PUBLIC_SOCKET_URL",
    env.NEXT_PUBLIC_SOCKET_URL,
    ["https:", "wss:"],
    env.APP_ENV,
  );

  if (!env.BETTER_AUTH_SECRET) {
    context.addIssue({
      code: "custom",
      path: ["BETTER_AUTH_SECRET"],
      message: "BETTER_AUTH_SECRET is required in production.",
    });
  }

  if (!env.RESEND_API_KEY) {
    context.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message:
        "RESEND_API_KEY is required in production for auth email verification/reset delivery.",
    });
  }

  if (!env.RESEND_FROM_EMAIL && !env.EMAIL_FROM) {
    context.addIssue({
      code: "custom",
      path: ["RESEND_FROM_EMAIL"],
      message:
        "RESEND_FROM_EMAIL or EMAIL_FROM is required in production for auth emails.",
    });
  }

  if (env.APP_ENV === "production" && env.ENABLE_DEV_AUTH) {
    context.addIssue({
      code: "custom",
      path: ["ENABLE_DEV_AUTH"],
      message: "ENABLE_DEV_AUTH must be disabled in production.",
    });
  }
});

export type WebEnv = z.infer<typeof WebEnvSchema>;

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

export function parseWebEnv(env: Record<string, string | undefined>): WebEnv {
  const parsed = WebEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new EnvValidationError(
      `Invalid web environment:\n${formatZodIssues(parsed.error.issues)}`,
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

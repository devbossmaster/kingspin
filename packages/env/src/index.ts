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
const TELEBIRR_RECEIPT_HOSTNAME = "transactioninfo.ethiotelecom.et";

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
      .enum([
        "MANUAL",
        "MOCK",
        "TELEBIRR_RECEIPT",
        "TELEBIRR_OFFICIAL",
        "MANUAL_BANK",
        "NOWPAYMENTS",
        "CHAPA",
        "STRIPE",
        "CUSTOM",
      ])
      .optional(),
    TELEBIRR_RECEIPT_VERIFICATION_ENABLED: BooleanStringSchema.default(false),
    TELEBIRR_RECEIPT_BASE_URL: z
      .string()
      .url()
      .default(`https://${TELEBIRR_RECEIPT_HOSTNAME}/receipt`),
    TELEBIRR_EXPECTED_RECEIVER_NAME: OptionalStringSchema,
    TELEBIRR_EXPECTED_RECEIVER_ACCOUNT: OptionalStringSchema,
    TELEBIRR_EXPECTED_SHORT_CODE: OptionalStringSchema,
    TELEBIRR_DEPOSIT_MIN: z.coerce.number().positive().optional(),
    TELEBIRR_DEPOSIT_MAX: z.coerce.number().positive().optional(),
    DEPOSIT_MIN_ETB: z.coerce.number().positive().optional(),
    DEPOSIT_MAX_ETB: z.coerce.number().positive().optional(),
    WITHDRAWAL_MIN_ETB: z.coerce.number().positive().default(50),
    WITHDRAWAL_MAX_ETB: z.coerce.number().positive().default(1_000),
    TRANSFER_MIN_ETB: z.coerce.number().positive().default(1),
    TRANSFER_MAX_ETB: z.coerce.number().positive().default(1_000),
    PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(2_000),
    ROUND_ENTRY_CUTOFF_BUFFER_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(10_000)
      .default(2_000),
    TELEBIRR_DEPOSIT_INTENT_TTL_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(15),
    TELEBIRR_RECEIPT_HTTP_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(8_000),
    TELEBIRR_RECEIPT_MAX_HTML_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(200_000),
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
  .transform((env) => {
    const appEnv = resolveAppEnv(env);

    return {
      ...env,
      APP_ENV: appEnv,
      API_CORS_ORIGIN: env.API_CORS_ORIGIN ?? env.CORS_ORIGIN ?? env.WEB_URL,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? env.WEB_URL,
      ENABLE_LOCAL_DEV_AUTH: env.ENABLE_LOCAL_DEV_AUTH ?? env.ENABLE_DEV_AUTH,
      PAYMENT_PROVIDER:
        env.PAYMENT_PROVIDER ?? (appEnv === "local" ? "MOCK" : "MANUAL"),
      DEPOSIT_MIN_ETB:
        env.DEPOSIT_MIN_ETB ?? env.TELEBIRR_DEPOSIT_MIN ?? 10,
      DEPOSIT_MAX_ETB:
        env.DEPOSIT_MAX_ETB ?? env.TELEBIRR_DEPOSIT_MAX ?? 1_000,
    };
  });

export const ApiEnvSchema = ApiEnvBaseSchema.superRefine((env, context) => {
  if (env.DEPLOY_ENV && env.APP_ENV !== env.DEPLOY_ENV) {
    context.addIssue({
      code: "custom",
      path: ["APP_ENV"],
      message: "APP_ENV and DEPLOY_ENV must match when both are set.",
    });
  }

  if (env.APP_ENV !== "local" && env.NODE_ENV !== "production") {
    context.addIssue({
      code: "custom",
      path: ["NODE_ENV"],
      message: "NODE_ENV=production is required outside local development.",
    });
  }

  if (env.APP_ENV !== "local" && !env.ENABLE_REDIS) {
    context.addIssue({
      code: "custom",
      path: ["ENABLE_REDIS"],
      message:
        "ENABLE_REDIS=true is required outside local development for shared rate limiting and fraud protection.",
    });
  }

  if (env.APP_ENV !== "local" && !env.REDIS_URL) {
    context.addIssue({
      code: "custom",
      path: ["REDIS_URL"],
      message:
        "REDIS_URL is required outside local development for shared rate limiting and fraud protection.",
    });
  }

  if (env.APP_ENV !== "local" && env.PAYMENT_PROVIDER === "MOCK") {
    context.addIssue({
      code: "custom",
      path: ["PAYMENT_PROVIDER"],
      message:
        "PAYMENT_PROVIDER=MOCK is local-only. Use MANUAL or a configured real adapter stub outside local development.",
    });
  }

  const telebirrReceiptUrl = new URL(env.TELEBIRR_RECEIPT_BASE_URL);

  if (telebirrReceiptUrl.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      path: ["TELEBIRR_RECEIPT_BASE_URL"],
      message: "TELEBIRR_RECEIPT_BASE_URL must use HTTPS.",
    });
  }

  if (
    env.APP_ENV !== "local" &&
    telebirrReceiptUrl.hostname !== TELEBIRR_RECEIPT_HOSTNAME
  ) {
    context.addIssue({
      code: "custom",
      path: ["TELEBIRR_RECEIPT_BASE_URL"],
      message:
        "TELEBIRR_RECEIPT_BASE_URL must use transactioninfo.ethiotelecom.et outside local development.",
    });
  }

  if (env.DEPOSIT_MAX_ETB <= env.DEPOSIT_MIN_ETB) {
    context.addIssue({
      code: "custom",
      path: ["DEPOSIT_MAX_ETB"],
      message: "DEPOSIT_MAX_ETB must be greater than DEPOSIT_MIN_ETB.",
    });
  }

  if (env.WITHDRAWAL_MAX_ETB <= env.WITHDRAWAL_MIN_ETB) {
    context.addIssue({
      code: "custom",
      path: ["WITHDRAWAL_MAX_ETB"],
      message:
        "WITHDRAWAL_MAX_ETB must be greater than WITHDRAWAL_MIN_ETB.",
    });
  }

  if (env.TRANSFER_MAX_ETB <= env.TRANSFER_MIN_ETB) {
    context.addIssue({
      code: "custom",
      path: ["TRANSFER_MAX_ETB"],
      message: "TRANSFER_MAX_ETB must be greater than TRANSFER_MIN_ETB.",
    });
  }

  if (
    env.TELEBIRR_RECEIPT_HTTP_TIMEOUT_MS < 1_000 ||
    env.TELEBIRR_RECEIPT_HTTP_TIMEOUT_MS > 30_000
  ) {
    context.addIssue({
      code: "custom",
      path: ["TELEBIRR_RECEIPT_HTTP_TIMEOUT_MS"],
      message:
        "TELEBIRR_RECEIPT_HTTP_TIMEOUT_MS must be between 1000 and 30000.",
    });
  }

  if (
    env.TELEBIRR_RECEIPT_MAX_HTML_BYTES < 10_000 ||
    env.TELEBIRR_RECEIPT_MAX_HTML_BYTES > 1_000_000
  ) {
    context.addIssue({
      code: "custom",
      path: ["TELEBIRR_RECEIPT_MAX_HTML_BYTES"],
      message:
        "TELEBIRR_RECEIPT_MAX_HTML_BYTES must be between 10000 and 1000000.",
    });
  }

  if (env.APP_ENV !== "local") {
    const telebirrReceiptDepositsEnabled =
      env.TELEBIRR_RECEIPT_VERIFICATION_ENABLED ||
      env.PAYMENT_PROVIDER === "TELEBIRR_RECEIPT";

    if (
      env.PAYMENT_PROVIDER === "TELEBIRR_RECEIPT" &&
      !env.TELEBIRR_RECEIPT_VERIFICATION_ENABLED
    ) {
      context.addIssue({
        code: "custom",
        path: ["TELEBIRR_RECEIPT_VERIFICATION_ENABLED"],
        message:
          "TELEBIRR_RECEIPT_VERIFICATION_ENABLED=true is required outside local development when PAYMENT_PROVIDER=TELEBIRR_RECEIPT.",
      });
    }

    if (
      telebirrReceiptDepositsEnabled &&
      !env.TELEBIRR_EXPECTED_RECEIVER_NAME &&
      !env.TELEBIRR_EXPECTED_RECEIVER_ACCOUNT &&
      !env.TELEBIRR_EXPECTED_SHORT_CODE
    ) {
      context.addIssue({
        code: "custom",
        path: ["TELEBIRR_EXPECTED_RECEIVER_NAME"],
        message:
          "At least one Telebirr receiver identity field is required outside local development when receipt deposits are enabled.",
      });
    }
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

  if (env.ENABLE_LOCAL_DEV_AUTH) {
    context.addIssue({
      code: "custom",
      path: ["ENABLE_LOCAL_DEV_AUTH"],
      message:
        "ENABLE_LOCAL_DEV_AUTH must be disabled outside local development.",
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

  if (env.APP_ENV !== "local" && env.NODE_ENV !== "production") {
    context.addIssue({
      code: "custom",
      path: ["NODE_ENV"],
      message: "NODE_ENV=production is required outside local development.",
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

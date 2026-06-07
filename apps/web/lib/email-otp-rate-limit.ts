import { prisma } from "@kingspin/db";
import { createHmac, randomUUID } from "node:crypto";
import { EMAIL_OTP_RESEND_COOLDOWN_SECONDS } from "./email-otp";

function emailRateLimitKey(email: string, secret: string) {
  const digest = createHmac("sha256", secret)
    .update(email.trim().toLowerCase())
    .digest("hex");

  return `email-otp:send:${digest}`;
}

export async function markEmailOtpSent(
  email: string,
  secret: string,
  nowMs = Date.now(),
) {
  const key = emailRateLimitKey(email, secret);

  await prisma.rateLimit.upsert({
    where: { key },
    create: {
      id: randomUUID(),
      key,
      count: 1,
      lastRequest: BigInt(nowMs),
    },
    update: {
      count: { increment: 1 },
      lastRequest: BigInt(nowMs),
    },
  });
}

export async function claimEmailOtpSend(
  email: string,
  secret: string,
  nowMs = Date.now(),
) {
  const key = emailRateLimitKey(email, secret);
  const now = BigInt(nowMs);
  const cutoff = BigInt(
    nowMs - EMAIL_OTP_RESEND_COOLDOWN_SECONDS * 1000,
  );
  const claimed = await prisma.$queryRaw<Array<{ lastRequest: bigint }>>`
    INSERT INTO "rate_limits" ("id", "key", "count", "lastRequest")
    VALUES (${randomUUID()}, ${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE
    SET
      "count" = "rate_limits"."count" + 1,
      "lastRequest" = EXCLUDED."lastRequest"
    WHERE "rate_limits"."lastRequest" <= ${cutoff}
    RETURNING "lastRequest"
  `;

  if (claimed.length > 0) {
    return 0;
  }

  const existing = await prisma.rateLimit.findUnique({
    where: { key },
    select: { lastRequest: true },
  });
  const elapsedMs = existing ? nowMs - Number(existing.lastRequest) : 0;

  return Math.max(
    1,
    Math.ceil(
      (EMAIL_OTP_RESEND_COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000,
    ),
  );
}

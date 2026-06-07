import { prisma, Role } from "@kingspin/db";
import { parseWebEnv } from "@kingspin/env";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP, username } from "better-auth/plugins";
import { createHmac } from "node:crypto";
import { Resend } from "resend";
import {
  EMAIL_OTP_LENGTH,
  EMAIL_OTP_MAX_ATTEMPTS,
  EMAIL_OTP_TTL_SECONDS,
} from "./email-otp";
import {
  claimEmailOtpSend,
  markEmailOtpSent,
} from "./email-otp-rate-limit";

const env = parseWebEnv(process.env);
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
const emailOtpHashSecret =
  env.BETTER_AUTH_SECRET ?? "spin-battle-local-email-otp-hash";

async function hashEmailOtp(otp: string) {
  return createHmac("sha256", emailOtpHashSecret)
    .update(otp)
    .digest("base64url");
}

function getWebUrl() {
  return env.BETTER_AUTH_URL;
}

function getTrustedOrigins() {
  const origins = new Set<string>();
  const candidates = [
    getWebUrl(),
    env.NEXT_PUBLIC_API_URL,
    env.NEXT_PUBLIC_SOCKET_URL,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    try {
      const url = new URL(candidate);
      origins.add(url.origin);
    } catch {
      // Ignore malformed optional origins. Better Auth still enforces its own URL.
    }
  }

  return [...origins];
}

function getEmailFrom() {
  return (
    env.RESEND_FROM_EMAIL ??
    env.EMAIL_FROM ??
    "Spin Battle <onboarding@resend.dev>"
  );
}

function queueAuthEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  if (!resend) {
    if (env.APP_ENV === "production") {
      throw new Error("RESEND_API_KEY is required to send auth emails.");
    }

    console.warn(
      `[auth-email] RESEND_API_KEY is missing. Skipped "${args.subject}" for ${args.to}.`,
    );
    return;
  }

  void resend.emails
    .send({
      from: getEmailFrom(),
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    })
    .catch((error) => {
      console.error("[auth-email] Failed to send auth email.", error);
    });
}

function authLinkEmailTemplate(args: {
  title: string;
  eyebrow: string;
  body: string;
  href: string;
  action: string;
}) {
  return {
    text: `${args.body}\n\n${args.href}`,
    html: `
      <div style="font-family: Inter, Arial, sans-serif; background: #020617; color: #e5e7eb; padding: 32px;">
        <div style="max-width: 560px; margin: 0 auto; border: 1px solid rgba(250, 204, 21, 0.3); background: #0f172a; padding: 28px; border-radius: 12px;">
          <p style="margin: 0 0 12px; color: #facc15; font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;">${args.eyebrow}</p>
          <h1 style="margin: 0 0 16px; color: #ffffff; font-size: 24px;">${args.title}</h1>
          <p style="margin: 0 0 24px; color: #cbd5e1; line-height: 1.6;">${args.body}</p>
          <a href="${args.href}" style="display: inline-block; background: #facc15; color: #020617; padding: 12px 18px; border-radius: 8px; font-weight: 800; text-decoration: none;">${args.action}</a>
          <p style="margin: 24px 0 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">If the button does not work, paste this URL into your browser:<br>${args.href}</p>
        </div>
      </div>
    `,
  };
}

function verificationCodeEmailTemplate(otp: string) {
  return {
    text: [
      "Your Spin Battle verification code is:",
      "",
      otp,
      "",
      "This code expires in 10 minutes.",
      "",
      "If you did not create this account, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family: Inter, Arial, sans-serif; background: #020617; color: #e5e7eb; padding: 32px;">
        <div style="max-width: 560px; margin: 0 auto; border: 1px solid rgba(56, 189, 248, 0.3); background: #0f172a; padding: 30px; border-radius: 16px;">
          <p style="margin: 0 0 12px; color: #86efac; font-size: 12px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase;">Spin Battle</p>
          <h1 style="margin: 0 0 14px; color: #ffffff; font-size: 26px;">Verify your email</h1>
          <p style="margin: 0; color: #cbd5e1; line-height: 1.6;">Your Spin Battle verification code is:</p>
          <div style="margin: 24px 0; border: 1px solid rgba(74, 222, 128, 0.35); background: #071a24; border-radius: 14px; padding: 20px; color: #ffffff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 34px; font-weight: 900; letter-spacing: 0.28em; text-align: center;">${otp}</div>
          <p style="margin: 0 0 12px; color: #cbd5e1; line-height: 1.6;">This code expires in 10 minutes.</p>
          <p style="margin: 0; color: #94a3b8; font-size: 13px; line-height: 1.6;">If you did not create this account, you can ignore this email.</p>
        </div>
      </div>
    `,
  };
}

export const auth = betterAuth({
  appName: "Spin Battle",
  baseURL: getWebUrl(),
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: getTrustedOrigins(),
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: {
      "/email-otp/send-verification-otp": {
        window: 60,
        max: 1,
      },
      "/email-otp/verify-email": {
        window: 60,
        max: 10,
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const requestedPath = ctx.request
        ? new URL(ctx.request.url).pathname
        : null;

      if (
        ctx.path !== "/email-otp/send-verification-otp" ||
        !requestedPath?.endsWith("/email-otp/send-verification-otp") ||
        ctx.body?.type !== "email-verification" ||
        typeof ctx.body?.email !== "string"
      ) {
        return;
      }

      const retryAfter = await claimEmailOtpSend(
        ctx.body.email,
        env.BETTER_AUTH_SECRET ?? "spin-battle-local-email-otp-rate-limit",
      );

      if (retryAfter > 0) {
        throw new APIError(
          "TOO_MANY_REQUESTS",
          {
            code: "OTP_RESEND_COOLDOWN",
            message: "Please wait before requesting another code.",
          },
          { "X-Retry-After": String(retryAfter) },
        );
      }
    }),
  },
  advanced: env.BETTER_AUTH_COOKIE_DOMAIN
    ? {
        crossSubDomainCookies: {
          enabled: true,
          domain: env.BETTER_AUTH_COOKIE_DOMAIN,
        },
      }
    : undefined,
  user: {
    fields: {
      name: "fullName",
    },
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        const email = authLinkEmailTemplate({
          eyebrow: "Spin Battle email change",
          title: "Confirm your new email",
          body: `Confirm changing your Spin Battle email from ${user.email} to ${newEmail}.`,
          href: url,
          action: "Confirm email change",
        });

        queueAuthEmail({
          to: newEmail,
          subject: "Confirm your Spin Battle email change",
          html: email.html,
          text: email.text,
        });
      },
    },
    additionalFields: {
      phoneNumber: {
        type: "string",
        required: true,
      },
      role: {
        type: "string",
        required: false,
        defaultValue: Role.PLAYER,
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const email = authLinkEmailTemplate({
        eyebrow: "Spin Battle account",
        title: "Reset your password",
        body: "Use this secure link to set a new Spin Battle password.",
        href: url,
        action: "Reset password",
      });

      queueAuthEmail({
        to: user.email,
        subject: "Reset your Spin Battle password",
        html: email.html,
        text: email.text,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: false,
    autoSignInAfterVerification: false,
  },
  plugins: [
    emailOTP({
      otpLength: EMAIL_OTP_LENGTH,
      expiresIn: EMAIL_OTP_TTL_SECONDS,
      allowedAttempts: EMAIL_OTP_MAX_ATTEMPTS,
      storeOTP: { hash: hashEmailOtp },
      resendStrategy: "rotate",
      overrideDefaultEmailVerification: true,
      rateLimit: {
        window: 60,
        max: 10,
      },
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "email-verification") {
          return;
        }

        await markEmailOtpSent(
          email,
          env.BETTER_AUTH_SECRET ?? "spin-battle-local-email-otp-rate-limit",
        );

        const template = verificationCodeEmailTemplate(otp);

        queueAuthEmail({
          to: email,
          subject: "Your Spin Battle verification code",
          html: template.html,
          text: template.text,
        });
      },
    }),
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
      usernameValidator: (value) => /^[a-zA-Z0-9_.]+$/.test(value),
    }),
    nextCookies(),
  ],
});

import { prisma, Role } from "@kingspin/db";
import { parseWebEnv } from "@kingspin/env";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { Resend } from "resend";

const env = parseWebEnv(process.env);
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

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

export const auth = betterAuth({
  appName: "Spin Battle",
  baseURL: getWebUrl(),
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: getTrustedOrigins(),
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
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
    sendOnSignIn: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      const email = authLinkEmailTemplate({
        eyebrow: "Spin Battle verification",
        title: "Verify your email",
        body: "Confirm this email address before entering Spin Battle rooms.",
        href: url,
        action: "Verify email",
      });

      queueAuthEmail({
        to: user.email,
        subject: "Verify your Spin Battle email",
        html: email.html,
        text: email.text,
      });
    },
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
      usernameValidator: (value) => /^[a-zA-Z0-9_.]+$/.test(value),
    }),
    nextCookies(),
  ],
});

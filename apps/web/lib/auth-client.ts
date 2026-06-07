"use client";

import { createAuthClient } from "better-auth/react";
import {
  emailOTPClient,
  inferAdditionalFields,
  usernameClient,
} from "better-auth/client/plugins";
import type { auth } from "./auth";

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    emailOTPClient(),
    usernameClient(),
  ],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  sendVerificationEmail,
  requestPasswordReset,
  resetPassword,
  changeEmail,
  changePassword,
  updateUser,
  listSessions,
  revokeSessions,
  revokeOtherSessions,
} = authClient;

export const emailOtp = authClient.emailOtp;
export const forgotPassword = requestPasswordReset;

export type AuthSession = typeof authClient.$Infer.Session;

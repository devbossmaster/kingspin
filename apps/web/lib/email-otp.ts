export const EMAIL_OTP_LENGTH = 6;
export const EMAIL_OTP_TTL_SECONDS = 10 * 60;
export const EMAIL_OTP_MAX_ATTEMPTS = 5;
export const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;

export const PENDING_EMAIL_KEY = "spin-battle:pending-verification-email";
export const PENDING_CALLBACK_KEY =
  "spin-battle:pending-verification-callback";
export const PENDING_SENT_AT_KEY =
  "spin-battle:pending-verification-sent-at";

export function normalizeOtp(value: string) {
  return value.replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH);
}

export function maskEmail(email: string) {
  const [localPart, domain] = email.trim().split("@");

  if (!localPart || !domain) {
    return email;
  }

  const visibleLength = Math.min(2, localPart.length);
  const visible = localPart.slice(0, visibleLength);
  const maskedLength = Math.max(3, localPart.length - visibleLength);

  return `${visible}${"*".repeat(maskedLength)}@${domain}`;
}

export function safeRelativeCallback(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/spinpro";
  }

  return value;
}

export function remainingCooldownSeconds(
  sentAtMs: number,
  nowMs = Date.now(),
) {
  const elapsedSeconds = Math.floor((nowMs - sentAtMs) / 1000);

  return Math.max(0, EMAIL_OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
}

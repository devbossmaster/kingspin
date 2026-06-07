import { describe, expect, it } from "vitest";
import {
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
  maskEmail,
  normalizeOtp,
  remainingCooldownSeconds,
  safeRelativeCallback,
} from "./email-otp";

describe("email OTP helpers", () => {
  it("keeps only the first six numeric digits for paste and autofill", () => {
    expect(normalizeOtp("12 3-4567")).toBe("123456");
  });

  it("masks the local part without hiding the email domain", () => {
    expect(maskEmail("biniam@gmail.com")).toBe("bi****@gmail.com");
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
  });

  it("only accepts local callback paths", () => {
    expect(safeRelativeCallback("/wallet")).toBe("/wallet");
    expect(safeRelativeCallback("//evil.example")).toBe("/spinpro");
    expect(safeRelativeCallback("https://evil.example")).toBe("/spinpro");
  });

  it("counts down from the configured resend cooldown", () => {
    const sentAt = 10_000;

    expect(remainingCooldownSeconds(sentAt, sentAt)).toBe(
      EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
    );
    expect(remainingCooldownSeconds(sentAt, sentAt + 15_500)).toBe(45);
    expect(remainingCooldownSeconds(sentAt, sentAt + 61_000)).toBe(0);
  });
});

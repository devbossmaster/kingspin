function getRawMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }

  return "";
}

export function toHumanErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
) {
  const rawMessage = getRawMessage(error).trim();
  const message = rawMessage || fallback;
  const lower = message.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("connection") ||
    lower.includes("socket disconnected")
  ) {
    return "Connection dropped. Please check your internet and try again.";
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "That took too long. Please try again in a moment.";
  }

  if (lower.includes("401") || lower.includes("unauthorized")) {
    return "Please sign in again to continue.";
  }

  if (lower.includes("403") || lower.includes("forbidden")) {
    return "You do not have access to do that.";
  }

  if (lower.includes("verify") && lower.includes("email")) {
    return "Please verify your email before entering.";
  }

  if (
    lower.includes("no longer open") ||
    lower.includes("open round") ||
    lower.includes("round already moved")
  ) {
    return "Round already moved on. Try the new round.";
  }

  if (
    lower.includes("insufficient balance") ||
    lower.includes("not enough balance")
  ) {
    return "Your balance is not enough for this entry.";
  }

  if (lower.includes("wallet unavailable") || lower.includes("wallet")) {
    return "Wallet is taking a moment to sync. Please try again shortly.";
  }

  if (lower.includes("room not found") || lower.includes("not found")) {
    return "We could not find that room. It may have just restarted.";
  }

  if (lower.includes("too many") || lower.includes("rate limit")) {
    return "Slow down for a moment, then try again.";
  }

  if (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("server")
  ) {
    return "The game server is busy. Please try again shortly.";
  }

  return message.length > 180 ? fallback : message;
}

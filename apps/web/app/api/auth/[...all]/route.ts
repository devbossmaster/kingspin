import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../lib/auth";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(request: Request) {
  const response = await handlers.POST(request);
  const path = new URL(request.url).pathname;

  if (
    path.endsWith("/email-otp/verify-email") &&
    !response.ok &&
    response.status !== 429
  ) {
    return Response.json(
      {
        code: "INVALID_OR_EXPIRED_CODE",
        message: "Invalid or expired code",
      },
      { status: 400 },
    );
  }

  return response;
}

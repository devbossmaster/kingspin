import { Injectable, Logger } from "@nestjs/common";
import { getApiEnv } from "../../config/api-env";
import type { AuthBridgeRequest, AuthBridgeUser } from "./auth.types";

@Injectable()
export class AuthBridgeService {
  private readonly logger = new Logger(AuthBridgeService.name);

  async validateRequest(
    request: AuthBridgeRequest,
  ): Promise<AuthBridgeUser | null> {
    const env = getApiEnv();
    const betterAuthUser = await this.validateBetterAuthSession(request);

    if (betterAuthUser) {
      return betterAuthUser;
    }

    if (env.NODE_ENV !== "production" && env.ENABLE_DEV_AUTH) {
      const devUserId = this.getHeader(request, "x-dev-user-id");

      if (devUserId) {
        return { id: devUserId };
      }
    }

    return null;
  }

  private async validateBetterAuthSession(
    request: AuthBridgeRequest,
  ): Promise<AuthBridgeUser | null> {
    const cookie = this.getHeader(request, "cookie");

    if (!cookie) {
      return null;
    }

    const env = getApiEnv();
    const sessionUrl = new URL("/api/auth/get-session", env.BETTER_AUTH_URL);

    sessionUrl.searchParams.set("disableRefresh", "true");

    try {
      const response = await fetch(sessionUrl, {
        method: "GET",
        headers: this.buildBetterAuthHeaders(request, cookie),
      });

      if (!response.ok) {
        this.logger.warn(
          `Better Auth session validation failed with HTTP ${response.status}.`,
        );
        return null;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            user?: {
              id?: unknown;
            };
          }
        | null;
      const userId =
        typeof payload?.user?.id === "string" ? payload.user.id.trim() : "";

      return userId ? { id: userId } : null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Better Auth error";

      this.logger.warn(`Better Auth session validation unavailable: ${message}`);
      return null;
    }
  }

  private getHeader(request: AuthBridgeRequest, name: string) {
    const value = request.headers?.[name];

    if (Array.isArray(value)) {
      return value[0]?.trim() || null;
    }

    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private buildBetterAuthHeaders(
    request: AuthBridgeRequest,
    cookie: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      cookie,
    };

    const userAgent = this.getHeader(request, "user-agent");
    const forwardedFor = this.getHeader(request, "x-forwarded-for");

    if (userAgent) {
      headers["user-agent"] = userAgent;
    }

    if (forwardedFor) {
      headers["x-forwarded-for"] = forwardedFor;
    }

    return headers;
  }
}

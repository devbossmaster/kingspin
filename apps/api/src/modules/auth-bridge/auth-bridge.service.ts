import { Injectable } from "@nestjs/common";
import { getApiEnv } from "../../config/api-env";
import type { AuthBridgeRequest, AuthBridgeUser } from "./auth.types";

@Injectable()
export class AuthBridgeService {
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
    _request: AuthBridgeRequest,
  ): Promise<AuthBridgeUser | null> {
    // TODO: When apps/web defines a Better Auth server instance, import it and
    // call auth.api.getSession({ headers }) with the incoming request headers.
    return null;
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
}

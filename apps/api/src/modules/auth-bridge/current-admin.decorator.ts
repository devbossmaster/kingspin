import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AdminBridgeUser, AuthBridgeRequest } from "./auth.types";

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminBridgeUser => {
    const request = context.switchToHttp().getRequest<AuthBridgeRequest>();

    return request.adminUser as AdminBridgeUser;
  },
);

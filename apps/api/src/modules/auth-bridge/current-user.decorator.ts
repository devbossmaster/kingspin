import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthBridgeRequest, AuthBridgeUser } from "./auth.types";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthBridgeUser => {
    const request = context.switchToHttp().getRequest<AuthBridgeRequest>();

    return request.user as AuthBridgeUser;
  },
);

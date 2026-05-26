import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthBridgeService } from "./auth-bridge.service";
import type { AuthBridgeRequest } from "./auth.types";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authBridgeService: AuthBridgeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthBridgeRequest>();
    const user = await this.authBridgeService.validateRequest(request);

    if (!user) {
      throw new UnauthorizedException(
        "Authenticated session required. Better Auth bridge is not configured yet.",
      );
    }

    request.user = user;
    request.authUser = user;

    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { getApiEnv } from "../config/api-env";

@Injectable()
export class AdminDevGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providedKey = request.headers["x-admin-dev-key"];
    const expectedKey = getApiEnv().ADMIN_DEV_KEY;
    const env = getApiEnv();

    if (env.APP_ENV !== "local" || env.NODE_ENV === "production") {
      throw new UnauthorizedException(
        "Admin development key routes are disabled outside local development.",
      );
    }

    if (!expectedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException("Invalid admin development key.");
    }

    return true;
  }
}

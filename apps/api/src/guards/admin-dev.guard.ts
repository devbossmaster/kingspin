import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

@Injectable()
export class AdminDevGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providedKey = request.headers["x-admin-dev-key"];
    const expectedKey = process.env.ADMIN_DEV_KEY;

    if (!expectedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException("Invalid admin development key.");
    }

    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { getApiEnv } from '../config/api-env';

type AdminDevRequest = {
  headers: Record<string, string | string[] | undefined>;
};

@Injectable()
export class AdminDevGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminDevRequest>();
    const providedKey = request.headers['x-admin-dev-key'];
    const expectedKey = getApiEnv().ADMIN_DEV_KEY;
    const env = getApiEnv();

    /**
     * ADMIN_DEV_KEY is a static local-development helper only. Never expose
     * these routes publicly, never configure the key in staging/production, and
     * rotate it immediately if it is pasted into logs, chat, or tickets.
     */
    if (env.APP_ENV !== 'local' || env.NODE_ENV === 'production') {
      throw new UnauthorizedException(
        'Admin development key routes are disabled outside local development.',
      );
    }

    if (!expectedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException('Invalid admin development key.');
    }

    return true;
  }
}

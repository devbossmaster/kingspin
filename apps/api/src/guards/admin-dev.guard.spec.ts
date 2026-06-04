import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { resetApiEnvForTesting } from '../config/api-env';
import { AdminDevGuard } from './admin-dev.guard';

function buildContext(
  headers: Record<string, string | undefined> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminDevGuard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects requests when ADMIN_DEV_KEY is missing', () => {
    delete process.env.ADMIN_DEV_KEY;
    resetApiEnvForTesting();

    expect(() => new AdminDevGuard().canActivate(buildContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects requests with the wrong admin development key', () => {
    process.env.ADMIN_DEV_KEY = 'secret';
    resetApiEnvForTesting();

    expect(() =>
      new AdminDevGuard().canActivate(
        buildContext({ 'x-admin-dev-key': 'wrong' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('accepts requests with the configured admin development key', () => {
    process.env.ADMIN_DEV_KEY = 'secret';
    resetApiEnvForTesting();

    expect(
      new AdminDevGuard().canActivate(
        buildContext({ 'x-admin-dev-key': 'secret' }),
      ),
    ).toBe(true);
  });

  it('rejects admin development routes outside local development', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/app';
    process.env.WEB_URL = 'https://kingspin.example.com';
    process.env.API_CORS_ORIGIN = 'https://kingspin.example.com';
    process.env.BETTER_AUTH_SECRET = 'production-secret';
    process.env.RESEND_API_KEY = 'resend-production';
    process.env.RESEND_FROM_EMAIL = 'SpinPro <noreply@kingspin.com>';
    process.env.PAYMENT_PROVIDER = 'MANUAL';
    resetApiEnvForTesting();

    expect(() =>
      new AdminDevGuard().canActivate(
        buildContext({ 'x-admin-dev-key': 'secret' }),
      ),
    ).toThrow(UnauthorizedException);
  });
});

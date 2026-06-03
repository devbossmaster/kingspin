import { EnvValidationError, parseApiEnv } from '@kingspin/env';

describe('API environment validation', () => {
  it('fails safely when production critical environment variables are missing', () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        PAYMENT_PROVIDER: 'MANUAL',
      }),
    ).toThrow(EnvValidationError);
  });

  it('rejects local-only payment providers in production', () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        ADMIN_DEV_KEY: 'admin-production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@example.com>',
        PAYMENT_PROVIDER: 'MOCK',
      }),
    ).toThrow(EnvValidationError);
  });

  it('parses and validates the trusted proxy header flag', () => {
    expect(
      parseApiEnv({
        TRUST_PROXY_HEADERS: 'true',
      }).TRUST_PROXY_HEADERS,
    ).toBe(true);

    expect(() =>
      parseApiEnv({
        TRUST_PROXY_HEADERS: 'definitely',
      }),
    ).toThrow(EnvValidationError);
  });
});

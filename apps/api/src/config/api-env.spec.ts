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

  it('rejects local-only payment providers outside local development', () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        PAYMENT_PROVIDER: 'MOCK',
        ENABLE_REDIS: 'true',
        REDIS_URL: 'redis://redis.example.com:6379',
      }),
    ).toThrow(EnvValidationError);
  });

  it('defaults deployed payment provider to manual when omitted', () => {
    expect(
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        ENABLE_REDIS: 'true',
        REDIS_URL: 'redis://redis.example.com:6379',
      }).PAYMENT_PROVIDER,
    ).toBe('MANUAL');
  });

  it('requires production Node runtime outside local development', () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: 'test',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        PAYMENT_PROVIDER: 'MANUAL',
        ENABLE_REDIS: 'true',
        REDIS_URL: 'redis://redis.example.com:6379',
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

  it('defaults and validates the admin dev credit cap', () => {
    expect(parseApiEnv({}).ADMIN_DEV_CREDIT_MAX).toBe(10_000);
    expect(
      parseApiEnv({ ADMIN_DEV_CREDIT_MAX: '2500' }).ADMIN_DEV_CREDIT_MAX,
    ).toBe(2500);

    expect(() =>
      parseApiEnv({
        ADMIN_DEV_CREDIT_MAX: '0',
      }),
    ).toThrow(EnvValidationError);
  });

  it('maps the local dev auth flag with safe backward compatibility', () => {
    expect(parseApiEnv({ ENABLE_DEV_AUTH: 'true' }).ENABLE_LOCAL_DEV_AUTH).toBe(
      true,
    );
    expect(
      parseApiEnv({
        ENABLE_DEV_AUTH: 'true',
        ENABLE_LOCAL_DEV_AUTH: 'false',
      }).ENABLE_LOCAL_DEV_AUTH,
    ).toBe(false);
  });

  it('rejects ADMIN_DEV_KEY outside local development', () => {
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
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        PAYMENT_PROVIDER: 'MANUAL',
        ENABLE_REDIS: 'true',
        REDIS_URL: 'redis://redis.example.com:6379',
      }),
    ).toThrow(EnvValidationError);
  });

  it('requires Redis outside local development', () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        PAYMENT_PROVIDER: 'MANUAL',
        ENABLE_REDIS: 'false',
      }),
    ).toThrow(EnvValidationError);

    expect(
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        PAYMENT_PROVIDER: 'MANUAL',
        ENABLE_REDIS: 'true',
        REDIS_URL: 'redis://redis.example.com:6379',
      }).ENABLE_REDIS,
    ).toBe(true);
  });

  it('rejects local dev auth flags outside local development', () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        PAYMENT_PROVIDER: 'MANUAL',
        ENABLE_REDIS: 'true',
        REDIS_URL: 'redis://redis.example.com:6379',
        ENABLE_LOCAL_DEV_AUTH: 'true',
      }),
    ).toThrow(EnvValidationError);
  });

  it('requires HTTPS for Telebirr receipt verification base URL', () => {
    expect(() =>
      parseApiEnv({
        TELEBIRR_RECEIPT_BASE_URL:
          'http://transactioninfo.ethiotelecom.et/receipt',
      }),
    ).toThrow(EnvValidationError);
  });

  it('rejects non-official Telebirr receipt hosts outside local development', () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        PAYMENT_PROVIDER: 'MANUAL',
        ENABLE_REDIS: 'true',
        REDIS_URL: 'redis://redis.example.com:6379',
        TELEBIRR_RECEIPT_BASE_URL: 'https://evil.example.com/receipt',
      }),
    ).toThrow(EnvValidationError);
  });

  it('requires receiver identity when deployed Telebirr receipt verification is enabled', () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        PAYMENT_PROVIDER: 'MANUAL',
        ENABLE_REDIS: 'true',
        REDIS_URL: 'redis://redis.example.com:6379',
        TELEBIRR_RECEIPT_VERIFICATION_ENABLED: 'true',
      }),
    ).toThrow(EnvValidationError);
  });

  it('requires Telebirr receipt verification when it is the deployed payment provider', () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        PAYMENT_PROVIDER: 'TELEBIRR_RECEIPT',
        ENABLE_REDIS: 'true',
        REDIS_URL: 'redis://redis.example.com:6379',
        TELEBIRR_EXPECTED_RECEIVER_ACCOUNT: '251900000000',
      }),
    ).toThrow(EnvValidationError);

    expect(
      parseApiEnv({
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/app',
        WEB_URL: 'https://kingspin.example.com',
        API_CORS_ORIGIN: 'https://kingspin.example.com',
        BETTER_AUTH_SECRET: 'production-secret',
        RESEND_API_KEY: 'resend-production',
        RESEND_FROM_EMAIL: 'SpinPro <noreply@kingspin.io>',
        PAYMENT_PROVIDER: 'TELEBIRR_RECEIPT',
        ENABLE_REDIS: 'true',
        REDIS_URL: 'redis://redis.example.com:6379',
        TELEBIRR_RECEIPT_VERIFICATION_ENABLED: 'true',
        TELEBIRR_EXPECTED_RECEIVER_ACCOUNT: '251900000000',
      }).PAYMENT_PROVIDER,
    ).toBe('TELEBIRR_RECEIPT');
  });
});

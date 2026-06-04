import { Logger } from '@nestjs/common';
import { resetApiEnvForTesting } from '../../config/api-env';
import { AuthBridgeService } from './auth-bridge.service';

describe('AuthBridgeService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetApiEnvForTesting();
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    resetApiEnvForTesting();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function buildPrisma(user: { id: string } | null = { id: 'user-1' }) {
    return {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
    };
  }

  function buildService(user: { id: string } | null = { id: 'user-1' }) {
    const prisma = buildPrisma(user);

    return {
      service: new AuthBridgeService(prisma as any),
      prisma,
    };
  }

  function setProductionEnv() {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'production';
    process.env.WEB_URL = 'https://app.example.com';
    process.env.BETTER_AUTH_URL = 'https://app.example.com';
    process.env.API_CORS_ORIGIN = 'https://app.example.com';
    process.env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/app';
    process.env.BETTER_AUTH_SECRET = 'test-secret';
    process.env.RESEND_API_KEY = 'resend-test';
    process.env.EMAIL_FROM = 'SpinPro <auth@spinpro.com>';
    process.env.ENABLE_DEV_AUTH = 'false';
    process.env.PAYMENT_PROVIDER = 'MANUAL';
    process.env.ENABLE_REDIS = 'true';
    process.env.REDIS_URL = 'redis://redis.example.com:6379';
  }

  function setStagingEnv() {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'staging';
    process.env.WEB_URL = 'https://staging.example.com';
    process.env.BETTER_AUTH_URL = 'https://staging.example.com';
    process.env.API_CORS_ORIGIN = 'https://staging.example.com';
    process.env.DATABASE_URL =
      'postgresql://user:pass@staging-db.example.com:5432/app';
    process.env.BETTER_AUTH_SECRET = 'test-secret';
    process.env.RESEND_API_KEY = 'resend-test';
    process.env.EMAIL_FROM = 'SpinPro <auth@spinpro.com>';
    process.env.ENABLE_DEV_AUTH = 'false';
    process.env.ENABLE_LOCAL_DEV_AUTH = 'false';
    process.env.PAYMENT_PROVIDER = 'MANUAL';
    process.env.ENABLE_REDIS = 'true';
    process.env.REDIS_URL = 'redis://redis.example.com:6379';
  }

  it('fails closed when local dev auth is not enabled', async () => {
    const { service, prisma } = buildService();

    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'local';

    await expect(
      service.validateRequest({
        headers: { 'x-dev-user-id': 'user-1' },
      }),
    ).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('accepts x-dev-user-id only in local dev when the user exists', async () => {
    const { service, prisma } = buildService({ id: 'user-1' });

    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'local';
    process.env.ENABLE_LOCAL_DEV_AUTH = 'true';

    await expect(
      service.validateRequest({
        headers: { 'x-dev-user-id': 'user-1' },
      }),
    ).resolves.toEqual({ id: 'user-1' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('LOCAL DEVELOPMENT AUTH BYPASS ENABLED'),
    );
  });

  it('rejects x-dev-user-id in local dev when the user does not exist', async () => {
    const { service } = buildService(null);

    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'local';
    process.env.ENABLE_LOCAL_DEV_AUTH = 'true';

    await expect(
      service.validateRequest({
        headers: { 'x-dev-user-id': 'missing-user' },
      }),
    ).resolves.toBeNull();
  });

  it('does not accept x-dev-user-id in staging', async () => {
    const { service, prisma } = buildService({ id: 'user-1' });

    setStagingEnv();

    await expect(
      service.validateRequest({
        headers: { 'x-dev-user-id': 'user-1' },
      }),
    ).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not accept x-dev-user-id in production', async () => {
    const { service, prisma } = buildService({ id: 'user-1' });

    setProductionEnv();

    await expect(
      service.validateRequest({
        headers: { 'x-dev-user-id': 'user-1' },
      }),
    ).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('validates a real Better Auth session through the web auth endpoint', async () => {
    const { service } = buildService();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ user: { id: 'user-1' } }),
    });

    setProductionEnv();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      service.validateRequest({
        headers: {
          cookie: 'better-auth.session_token=signed-token',
          'user-agent': 'jest',
          'x-forwarded-for': '203.0.113.10',
        },
      }),
    ).resolves.toEqual({ id: 'user-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCall = fetchMock.mock.calls[0] as [
      URL,
      { headers: Record<string, string> },
    ];

    expect(String(fetchCall[0])).toBe(
      'https://app.example.com/api/auth/get-session?disableRefresh=true',
    );
    expect(fetchCall[1].headers).toMatchObject({
      accept: 'application/json',
      cookie: 'better-auth.session_token=signed-token',
      'user-agent': 'jest',
      'x-forwarded-for': '203.0.113.10',
    });
  });

  it('fails closed when Better Auth session validation is unavailable', async () => {
    const { service } = buildService();

    setProductionEnv();
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    await expect(
      service.validateRequest({
        headers: { cookie: 'better-auth.session_token=signed-token' },
      }),
    ).resolves.toBeNull();
  });
});

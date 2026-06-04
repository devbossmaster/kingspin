import { ExecutionContext, HttpException } from '@nestjs/common';
import { SimpleRateLimitGuard } from './simple-rate-limit.guard';

type RedisRateLimitMock = {
  isEnabled: jest.MockedFunction<() => boolean>;
  incrementWithTtl: jest.MockedFunction<
    (
      key: string,
      ttlMs: number,
    ) => Promise<{ count: number; ttlMs: number } | null>
  >;
};

function buildContext(args: {
  method: string;
  url: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socketRemoteAddress?: string;
  response?: { setHeader: jest.Mock };
}): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        method: args.method,
        originalUrl: args.url,
        ip: args.ip,
        headers: args.headers ?? {},
        socket: {
          remoteAddress: args.socketRemoteAddress,
        },
      }),
      getResponse: () =>
        args.response ?? {
          setHeader: jest.fn(),
        },
    }),
  } as unknown as ExecutionContext;
}

function buildGuard(
  overrides: Partial<
    ConstructorParameters<typeof SimpleRateLimitGuard>[0]
  > = {},
) {
  return new SimpleRateLimitGuard({
    defaultWindowMs: 60_000,
    defaultMaxRequests: 1_000,
    isProduction: true,
    trustProxyHeaders: false,
    appEnv: 'local',
    allowInMemoryFallback: true,
    ...overrides,
  });
}

function buildRedisMock(): RedisRateLimitMock {
  return {
    isEnabled: jest.fn(() => true),
    incrementWithTtl: jest.fn(() => Promise.resolve(null)),
  };
}

describe('SimpleRateLimitGuard', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps entry placement coarse IP limits high enough for shared networks', async () => {
    const guard = buildGuard();

    for (let index = 0; index < 240; index += 1) {
      await expect(
        guard.canActivate(
          buildContext({
            method: 'POST',
            url: '/rooms/room-1/entries',
          }),
        ),
      ).resolves.toBe(true);
    }

    await expect(
      guard.canActivate(
        buildContext({
          method: 'POST',
          url: '/rooms/room-1/entries',
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('keeps public live-state on a separate moderate bucket', async () => {
    const guard = buildGuard({
      defaultMaxRequests: 1,
    });

    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/rooms/room-1/live-state',
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/rooms/room-1/live-state',
        }),
      ),
    ).resolves.toBe(true);
  });

  it('sets rate-limit response headers', async () => {
    const response = {
      setHeader: jest.fn(),
    };
    const guard = buildGuard();

    await guard.canActivate(
      buildContext({
        method: 'GET',
        url: '/rooms/room-1/live-state',
        response,
      }),
    );

    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 120);
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Remaining',
      119,
    );
  });

  it('increments Redis buckets and rejects over the limit', async () => {
    const redis = buildRedisMock();
    redis.incrementWithTtl
      .mockResolvedValueOnce({ count: 1, ttlMs: 60_000 })
      .mockResolvedValueOnce({ count: 2, ttlMs: 59_000 });
    const guard = buildGuard({
      defaultMaxRequests: 1,
      appEnv: 'production',
      allowInMemoryFallback: false,
      redis,
    });

    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/health',
          ip: '10.0.0.5',
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/health',
          ip: '10.0.0.5',
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(redis.incrementWithTtl).toHaveBeenCalledWith(
      'ratelimit:global:default:10.0.0.5',
      60_000,
    );
  });

  it('expires in-memory buckets after the configured TTL', async () => {
    jest.useFakeTimers({ now: 1_000 });
    const guard = buildGuard({
      defaultWindowMs: 1_000,
      defaultMaxRequests: 1,
    });
    const request = {
      method: 'GET',
      url: '/health',
      ip: '10.0.0.5',
    };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    await expect(
      guard.canActivate(buildContext(request)),
    ).rejects.toBeInstanceOf(HttpException);

    jest.setSystemTime(2_001);

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
  });

  it('falls back to in-memory storage only when local/test fallback is allowed', async () => {
    const redis = buildRedisMock();
    redis.incrementWithTtl.mockResolvedValue(null);
    const guard = buildGuard({
      defaultMaxRequests: 1,
      redis,
    });
    const request = {
      method: 'GET',
      url: '/health',
      ip: '10.0.0.5',
    };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    await expect(
      guard.canActivate(buildContext(request)),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('fails closed outside local/test when Redis storage is missing', async () => {
    const guard = buildGuard({
      appEnv: 'production',
      allowInMemoryFallback: false,
      redis: undefined,
    });

    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/health',
          ip: '10.0.0.5',
        }),
      ),
    ).rejects.toThrow('Global API rate limiter Redis storage is unavailable');
  });

  it('ignores spoofed X-Forwarded-For by default', async () => {
    const guard = buildGuard({
      defaultMaxRequests: 1,
    });

    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/health',
          ip: '10.0.0.5',
          headers: {
            'x-forwarded-for': '203.0.113.1',
          },
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/health',
          ip: '10.0.0.5',
          headers: {
            'x-forwarded-for': '203.0.113.2',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('uses X-Forwarded-For only when trusted proxy headers are enabled', async () => {
    const guard = buildGuard({
      defaultMaxRequests: 1,
      trustProxyHeaders: true,
    });

    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/health',
          ip: '10.0.0.5',
          headers: {
            'x-forwarded-for': '203.0.113.1',
          },
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/health',
          ip: '10.0.0.5',
          headers: {
            'x-forwarded-for': '203.0.113.2, 10.0.0.1',
          },
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/health',
          ip: '10.0.0.5',
          headers: {
            'x-forwarded-for': '203.0.113.2, 10.0.0.1',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('uses a stable fallback key when the request IP is missing', async () => {
    const guard = buildGuard({
      defaultMaxRequests: 1,
    });

    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/health',
          ip: '',
          headers: {
            'x-forwarded-for': '',
          },
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/health',
          ip: '',
          headers: {
            'x-forwarded-for': '',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

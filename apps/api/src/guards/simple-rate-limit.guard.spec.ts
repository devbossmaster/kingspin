import { HttpException } from '@nestjs/common';
import { SimpleRateLimitGuard } from './simple-rate-limit.guard';

function buildContext(args: {
  method: string;
  url: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socketRemoteAddress?: string;
  response?: { setHeader: jest.Mock };
}) {
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
  } as any;
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
    ...overrides,
  });
}

describe('SimpleRateLimitGuard', () => {
  it('keeps entry placement coarse IP limits high enough for shared networks', () => {
    const guard = buildGuard();

    for (let index = 0; index < 240; index += 1) {
      expect(
        guard.canActivate(
          buildContext({
            method: 'POST',
            url: '/rooms/room-1/entries',
          }),
        ),
      ).toBe(true);
    }

    expect(() =>
      guard.canActivate(
        buildContext({
          method: 'POST',
          url: '/rooms/room-1/entries',
        }),
      ),
    ).toThrow(HttpException);
  });

  it('keeps public live-state on a separate moderate bucket', () => {
    const guard = buildGuard({
      defaultMaxRequests: 1,
    });

    expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/rooms/room-1/live-state',
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        buildContext({
          method: 'GET',
          url: '/rooms/room-1/live-state',
        }),
      ),
    ).toBe(true);
  });

  it('sets rate-limit response headers', () => {
    const response = {
      setHeader: jest.fn(),
    };
    const guard = buildGuard();

    guard.canActivate(
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

  it('ignores spoofed X-Forwarded-For by default', () => {
    const guard = buildGuard({
      defaultMaxRequests: 1,
    });

    expect(
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
    ).toBe(true);

    expect(() =>
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
    ).toThrow(HttpException);
  });

  it('uses X-Forwarded-For only when trusted proxy headers are enabled', () => {
    const guard = buildGuard({
      defaultMaxRequests: 1,
      trustProxyHeaders: true,
    });

    expect(
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
    ).toBe(true);
    expect(
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
    ).toBe(true);

    expect(() =>
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
    ).toThrow(HttpException);
  });

  it('uses a stable fallback key when the request IP is missing', () => {
    const guard = buildGuard({
      defaultMaxRequests: 1,
    });

    expect(
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
    ).toBe(true);

    expect(() =>
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
    ).toThrow(HttpException);
  });
});

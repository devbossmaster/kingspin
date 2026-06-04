import type { NextFunction, Request, Response } from 'express';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  createCsrfMiddleware,
  createCsrfToken,
  shouldProtectRequest,
} from './csrf';

function buildRequest(args: {
  method: string;
  url: string;
  headers?: Record<string, string | undefined>;
}) {
  return {
    method: args.method,
    originalUrl: args.url,
    url: args.url,
    headers: args.headers ?? {},
  } as Request;
}

function buildResponse() {
  const response = {
    cookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };

  return response as unknown as Response & {
    cookie: jest.Mock;
    status: jest.Mock;
    json: jest.Mock;
  };
}

describe('CSRF middleware', () => {
  const secret = 'csrf-test-secret';

  it('issues a double-submit CSRF token and cookie', () => {
    const middleware = createCsrfMiddleware({
      secret,
      secureCookie: false,
    });
    const request = buildRequest({ method: 'GET', url: '/csrf' });
    const response = buildResponse();
    const next = jest.fn() as NextFunction;

    middleware(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
      }),
    );
    expect(response.status).toHaveBeenCalledWith(200);
    const jsonCalls = response.json.mock.calls as Array<
      [{ csrfToken: unknown }]
    >;

    expect(typeof jsonCalls[0]?.[0].csrfToken).toBe('string');
  });

  it('rejects cookie-authenticated mutating requests without a valid token', () => {
    const middleware = createCsrfMiddleware({
      secret,
      secureCookie: false,
    });
    const request = buildRequest({
      method: 'POST',
      url: '/rooms/room-1/entries',
      headers: {
        cookie: 'better-auth.session_token=signed',
      },
    });
    const response = buildResponse();
    const next = jest.fn() as NextFunction;

    middleware(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'CSRF token required.',
      }),
    );
  });

  it('accepts cookie-authenticated mutating requests with a valid token', () => {
    const token = createCsrfToken(secret);
    const middleware = createCsrfMiddleware({
      secret,
      secureCookie: false,
    });
    const request = buildRequest({
      method: 'POST',
      url: '/rooms/room-1/entries',
      headers: {
        cookie: `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; better-auth.session_token=signed`,
        [CSRF_HEADER_NAME]: token,
      },
    });
    const response = buildResponse();
    const next = jest.fn() as NextFunction;

    middleware(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('leaves GET requests unaffected', () => {
    const request = buildRequest({
      method: 'GET',
      url: '/rooms/room-1/live-state',
      headers: {
        cookie: 'better-auth.session_token=signed',
      },
    });

    expect(shouldProtectRequest(request)).toBe(false);
  });

  it('does not require CSRF for local admin dev-key requests', () => {
    const request = buildRequest({
      method: 'POST',
      url: '/admin/wallets/dev-credit',
      headers: {
        cookie: 'better-auth.session_token=signed',
        'x-admin-dev-key': 'local-secret',
      },
    });

    expect(shouldProtectRequest(request)).toBe(false);
  });
});

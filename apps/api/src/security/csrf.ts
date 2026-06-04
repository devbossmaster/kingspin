import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ApiEnv } from '@kingspin/env';

export const CSRF_COOKIE_NAME = 'ks_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_TOKEN_TTL_SECONDS = 60 * 60 * 2;

type CsrfMiddlewareOptions = {
  secret: string;
  secureCookie: boolean;
};

export function createCsrfMiddleware(options: CsrfMiddlewareOptions) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (isCsrfTokenRequest(request)) {
      const token = createCsrfToken(options.secret);

      setCsrfCookie(response, token, options.secureCookie);
      response.status(200).json({ csrfToken: token });
      return;
    }

    if (!shouldProtectRequest(request)) {
      next();
      return;
    }

    const cookieToken = parseCookieHeader(request.headers.cookie)[
      CSRF_COOKIE_NAME
    ];
    const headerToken = getHeader(request, CSRF_HEADER_NAME);

    if (
      !cookieToken ||
      !headerToken ||
      !constantTimeEqual(cookieToken, headerToken) ||
      !verifyCsrfToken(headerToken, options.secret)
    ) {
      response.status(403).json({
        statusCode: 403,
        message: 'CSRF token required.',
        error: 'Forbidden',
      });
      return;
    }

    next();
  };
}

export function getCsrfSecret(env: ApiEnv) {
  return (
    env.CSRF_SECRET ??
    env.BETTER_AUTH_SECRET ??
    env.ADMIN_DEV_KEY ??
    'local-development-csrf-secret'
  );
}

export function createCsrfToken(secret: string) {
  const nonce = randomBytes(32).toString('base64url');
  const signature = signCsrfNonce(nonce, secret);

  return `${nonce}.${signature}`;
}

export function verifyCsrfToken(token: string, secret: string) {
  const [nonce, signature, ...extra] = token.split('.');

  if (!nonce || !signature || extra.length > 0) {
    return false;
  }

  return constantTimeEqual(signature, signCsrfNonce(nonce, secret));
}

export function shouldProtectRequest(request: Request) {
  const method = request.method.toUpperCase();

  if (!MUTATING_METHODS.has(method)) {
    return false;
  }

  if (!request.headers.cookie) {
    return false;
  }

  if (isWebhookRoute(request) || isLocalAdminDevKeyRequest(request)) {
    return false;
  }

  return true;
}

function isCsrfTokenRequest(request: Request) {
  return (
    request.method.toUpperCase() === 'GET' &&
    normalizePath(request.originalUrl ?? request.url) === '/csrf'
  );
}

function isWebhookRoute(request: Request) {
  return normalizePath(request.originalUrl ?? request.url).startsWith(
    '/payments/webhooks/',
  );
}

function isLocalAdminDevKeyRequest(request: Request) {
  return Boolean(getHeader(request, 'x-admin-dev-key'));
}

function setCsrfCookie(
  response: Response,
  token: string,
  secureCookie: boolean,
) {
  response.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: CSRF_TOKEN_TTL_SECONDS * 1000,
    path: '/',
    sameSite: 'lax',
    secure: secureCookie,
  });
}

function signCsrfNonce(nonce: string, secret: string) {
  return createHmac('sha256', secret).update(nonce).digest('base64url');
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function getHeader(request: Request, name: string) {
  const value = request.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }

  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseCookieHeader(cookieHeader: string | undefined) {
  const cookies: Record<string, string> = {};

  for (const part of (cookieHeader ?? '').split(';')) {
    const separatorIndex = part.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = safeDecodeURIComponent(part.slice(0, separatorIndex).trim());
    const value = safeDecodeURIComponent(part.slice(separatorIndex + 1).trim());

    cookies[key] = value;
  }

  return cookies;
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePath(path: string) {
  return path.split('?')[0] || '/';
}

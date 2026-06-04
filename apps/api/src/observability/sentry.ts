import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';
import type { Request } from 'express';
import { getApiEnv } from '../config/api-env';

type SentryEnv = ReturnType<typeof getApiEnv>;

const FILTERED = '[Filtered]';
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|token|secret|session|password|wallet|payment|card|bank|private|phone)/i;

let sentryEnabled = false;

export function initSentry(env: SentryEnv = getApiEnv()) {
  if (!env.SENTRY_DSN) {
    sentryEnabled = false;
    return false;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    sendDefaultPii: false,
    beforeSend: (event) => sanitizeSentryEvent(event),
  });

  sentryEnabled = true;
  return true;
}

export function captureHttpException(exception: unknown, request: Request) {
  if (!sentryEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    const requestId = (request as Request & { requestId?: string }).requestId;

    if (requestId) {
      scope.setTag('request_id', requestId);
    }

    scope.setContext('http', {
      method: request.method,
      path: request.originalUrl ?? request.url,
      requestId: requestId ?? null,
      headers: sanitizeHeaders(request.headers),
      body: sanitizeValue(request.body),
    });

    Sentry.captureException(exception);
  });
}

export function sanitizeSentryEvent<TEvent extends Event>(
  event: TEvent,
): TEvent {
  const request = event.request;

  if (!request) {
    return event;
  }

  return {
    ...event,
    request: {
      ...request,
      cookies: undefined,
      headers: sanitizeHeaders(request.headers ?? {}),
      data: sanitizeValue(request.data),
    },
  } as TEvent;
}

export function sanitizeHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers ?? {})) {
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key) ? FILTERED : String(value);
  }

  return sanitized;
}

export function sanitizeValue(value: unknown): unknown {
  if (value === null || typeof value === 'undefined') {
    return value;
  }

  if (typeof value !== 'object') {
    return FILTERED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? FILTERED
      : sanitizeValue(nestedValue);
  }

  return sanitized;
}

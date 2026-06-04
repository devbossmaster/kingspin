import type { Event } from '@sentry/node';
import {
  initSentry,
  sanitizeHeaders,
  sanitizeSentryEvent,
  sanitizeValue,
} from './sentry';

describe('Sentry sanitization', () => {
  it('does not initialize Sentry without a DSN', () => {
    expect(
      initSentry({
        APP_ENV: 'local',
        SENTRY_DSN: undefined,
      } as never),
    ).toBe(false);
  });

  it('filters sensitive headers', () => {
    expect(
      sanitizeHeaders({
        authorization: 'Bearer secret',
        Cookie: 'better-auth.session_token=signed',
        'x-request-id': 'request-1',
      }),
    ).toEqual({
      authorization: '[Filtered]',
      Cookie: '[Filtered]',
      'x-request-id': 'request-1',
    });
  });

  it('filters sensitive request body fields recursively', () => {
    expect(
      sanitizeValue({
        amount: 100,
        walletId: 'wallet-1',
        payment: {
          cardToken: 'tok_123',
        },
        profile: {
          displayName: 'Player',
          phoneNumber: '+251000000000',
        },
      }),
    ).toEqual({
      amount: '[Filtered]',
      walletId: '[Filtered]',
      payment: '[Filtered]',
      profile: {
        displayName: '[Filtered]',
        phoneNumber: '[Filtered]',
      },
    });
  });

  it('sanitizes Sentry event request data before sending', () => {
    const event = sanitizeSentryEvent({
      request: {
        headers: {
          cookie: 'better-auth.session_token=signed',
          'x-request-id': 'request-1',
        },
        cookies: {
          session: 'signed',
        },
        data: {
          password: 'secret',
          reason: 'test',
        },
      },
    } as Event);

    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toEqual({
      cookie: '[Filtered]',
      'x-request-id': 'request-1',
    });
    expect(event.request?.data).toEqual({
      password: '[Filtered]',
      reason: '[Filtered]',
    });
  });
});

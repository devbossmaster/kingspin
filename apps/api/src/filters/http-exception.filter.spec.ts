import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { resetApiEnvForTesting } from '../config/api-env';
import { HttpExceptionFilter } from './http-exception.filter';

function buildHost(exceptionOverrides?: {
  method?: string;
  url?: string;
  requestId?: string;
}) {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();

  const request = {
    method: exceptionOverrides?.method ?? 'POST',
    originalUrl: exceptionOverrides?.url ?? '/rooms/room-1/entries',
    requestId: exceptionOverrides?.requestId ?? 'request-1',
  };

  return {
    response: { status, json },
    host: {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ status, json }),
      }),
    } as ArgumentsHost,
  };
}

describe('HttpExceptionFilter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    resetApiEnvForTesting();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    resetApiEnvForTesting();
  });

  it('keeps validation errors readable', () => {
    const filter = new HttpExceptionFilter();
    const { host, response } = buildHost();

    filter.catch(
      new BadRequestException({
        message: 'Validation failed.',
        issues: [{ path: 'amount', message: 'Required', code: 'invalid_type' }],
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Validation failed.',
        error: 'Bad Request',
        path: '/rooms/room-1/entries',
        requestId: 'request-1',
        issues: [
          {
            path: 'amount',
            message: 'Required',
            code: 'invalid_type',
          },
        ],
      }),
    );
  });

  it('hides unexpected error details in production responses', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      WEB_URL: 'https://app.example.com',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/kingspin',
      DIRECT_URL: 'postgresql://user:pass@localhost:5432/kingspin',
      BETTER_AUTH_SECRET: 'test-secret',
      RESEND_API_KEY: 'resend-test',
      EMAIL_FROM: 'SpinPro <auth@spinpro.com>',
      PAYMENT_PROVIDER: 'MANUAL',
    };
    resetApiEnvForTesting();

    const filter = new HttpExceptionFilter();
    const { host, response } = buildHost();

    filter.catch(new Error('database password leaked'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error.',
        error: 'Internal Server Error',
      }),
    );
    const jsonCalls = response.json.mock.calls as Array<
      [Record<string, unknown>]
    >;

    expect(jsonCalls[0]?.[0]).not.toHaveProperty('stack');
  });
});

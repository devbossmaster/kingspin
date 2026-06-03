import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { getApiEnv } from './config/api-env';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { SimpleRateLimitGuard } from './guards/simple-rate-limit.guard';
import { RequestLoggingInterceptor } from './interceptors/request-logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const env = getApiEnv();
  const logger = new Logger('Bootstrap');

  app.enableCors({
    origin: env.API_CORS_ORIGIN,
    credentials: true,
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    const forwardedRequestId = request.header('x-request-id');
    const requestId =
      forwardedRequestId && forwardedRequestId.trim().length > 0
        ? forwardedRequestId.trim()
        : randomUUID();

    (request as Request & { requestId: string }).requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalGuards(
    new SimpleRateLimitGuard({
      defaultWindowMs: env.RATE_LIMIT_WINDOW_MS,
      defaultMaxRequests: env.RATE_LIMIT_MAX,
      isProduction: env.NODE_ENV === 'production',
      trustProxyHeaders: env.TRUST_PROXY_HEADERS,
    }),
  );
  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  if (env.SENTRY_DSN) {
    logger.warn(
      'SENTRY_DSN is configured, but Sentry capture is not wired yet. TODO: add Sentry/OpenTelemetry provider integration.',
    );
  }

  await app.listen(env.PORT);

  logger.log(`KingSpin API running on http://localhost:${env.PORT}`);
}

bootstrap();

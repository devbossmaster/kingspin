import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getApiEnv } from './config/api-env';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { SimpleRateLimitGuard } from './guards/simple-rate-limit.guard';
import { RequestLoggingInterceptor } from './interceptors/request-logging.interceptor';
import { RedisService } from './modules/redis/redis.service';
import { initSentry } from './observability/sentry';
import { createCsrfMiddleware, getCsrfSecret } from './security/csrf';

async function bootstrap() {
  const env = getApiEnv();
  initSentry(env);

  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const allowInMemoryRateLimitFallback =
    env.APP_ENV === 'local' || env.NODE_ENV === 'test';

  if (
    !allowInMemoryRateLimitFallback &&
    (!env.ENABLE_REDIS || !env.REDIS_URL)
  ) {
    throw new Error(
      'Global API rate limiter requires Redis outside local/test environments. Set ENABLE_REDIS=true and REDIS_URL.',
    );
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hsts:
        env.APP_ENV === 'production'
          ? {
              maxAge: 15_552_000,
              includeSubDomains: true,
            }
          : false,
    }),
  );

  app.enableCors({
    origin: env.API_CORS_ORIGIN,
    credentials: true,
  });

  app.use(
    createCsrfMiddleware({
      secret: getCsrfSecret(env),
      secureCookie: env.APP_ENV === 'production',
    }),
  );

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
      appEnv: env.APP_ENV,
      allowInMemoryFallback: allowInMemoryRateLimitFallback,
      redis: app.get(RedisService),
    }),
  );
  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  await app.listen(env.PORT);

  logger.log(`KingSpin API running on http://localhost:${env.PORT}`);
}

void bootstrap();

import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, finalize, tap } from "rxjs";

type LoggedRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  requestId?: string;
};

type LoggedResponse = {
  statusCode?: number;
};

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<LoggedRequest>();
    const response = context.switchToHttp().getResponse<LoggedResponse>();
    const startedAt = Date.now();
    let logged = false;

    return next.handle().pipe(
      tap({
        error: (error) => {
          logged = true;
          this.logRequest(request, response, startedAt, error);
        },
      }),
      finalize(() => {
        if (!logged) {
          this.logRequest(request, response, startedAt);
        }
      }),
    );
  }

  private logRequest(
    request: LoggedRequest,
    response: LoggedResponse,
    startedAt: number,
    error?: unknown,
  ) {
    const statusCode =
      error instanceof HttpException
        ? error.getStatus()
        : error
          ? 500
          : (response.statusCode ?? 200);

    const payload = {
      event: "http_request",
      method: request.method,
      path: request.originalUrl ?? request.url,
      statusCode,
      durationMs: Date.now() - startedAt,
      requestId: request.requestId,
    };

    const serialized = JSON.stringify(payload);

    if (statusCode >= 500) {
      this.logger.error(serialized);
      return;
    }

    if (statusCode >= 400) {
      this.logger.warn(serialized);
      return;
    }

    this.logger.log(serialized);
  }
}

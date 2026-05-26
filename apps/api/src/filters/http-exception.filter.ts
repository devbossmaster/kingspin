import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { getApiEnv } from "../config/api-env";

type HttpRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  requestId?: string;
};

type HttpExceptionResponse = {
  message?: unknown;
  error?: unknown;
  issues?: unknown;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== "http") {
      throw exception;
    }

    const context = host.switchToHttp();
    const request = context.getRequest<HttpRequest>();
    const response = context.getResponse();
    const env = getApiEnv();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const responseObject =
      typeof exceptionResponse === "object" && exceptionResponse !== null
        ? (exceptionResponse as HttpExceptionResponse)
        : null;

    const rawMessage =
      responseObject && "message" in responseObject
        ? responseObject.message
        : typeof exceptionResponse === "string"
          ? exceptionResponse
          : exception instanceof Error
            ? exception.message
            : "Internal server error";

    const message =
      status >= 500 && env.NODE_ENV === "production"
        ? "Internal server error."
        : rawMessage;

    const error =
      responseObject && typeof responseObject.error === "string"
        ? responseObject.error
        : this.getDefaultErrorLabel(status);

    const path = request.originalUrl ?? request.url ?? "unknown";
    const body: Record<string, unknown> = {
      statusCode: status,
      message,
      error,
      path,
      timestamp: new Date().toISOString(),
    };

    if (request.requestId) {
      body.requestId = request.requestId;
    }

    if (responseObject) {
      for (const [key, value] of Object.entries(responseObject)) {
        if (["statusCode", "message", "error"].includes(key)) {
          continue;
        }

        body[key] = value;
      }
    }

    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;

      this.logger.error(
        JSON.stringify({
          event: "http_exception",
          method: request.method,
          path,
          statusCode: status,
          requestId: request.requestId,
          message: exception instanceof Error ? exception.message : String(exception),
        }),
        stack,
      );
    }

    response.status(status).json(body);
  }

  private getDefaultErrorLabel(status: number) {
    const label = HttpStatus[status];

    if (!label) {
      return "Error";
    }

    return label
      .split("_")
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(" ");
  }
}

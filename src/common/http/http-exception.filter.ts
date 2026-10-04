import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AppException } from './app-exception.js';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

const CODE_BY_STATUS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(HttpExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();

    const { status, body } = toErrorBody(exception);
    body.error.requestId = req.id;

    if (status >= 500) {
      this.logger.error({ err: exception, path: req.originalUrl }, 'Unhandled request error');
    }

    res.status(status).json(body);
  }
}

export function toErrorBody(exception: unknown): { status: number; body: ErrorBody } {
  if (exception instanceof AppException) {
    return {
      status: exception.getStatus(),
      body: {
        error: { code: exception.code, message: exception.message, details: exception.details },
      },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    // ValidationPipe puts the per-field messages in `message` as an array.
    const messages =
      typeof response === 'object' && response !== null && 'message' in response
        ? response.message
        : undefined;

    if (Array.isArray(messages)) {
      return {
        status,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Some fields are missing or invalid.',
            details: messages,
          },
        },
      };
    }

    return {
      status,
      body: { error: { code: CODE_BY_STATUS[status] ?? 'HTTP_ERROR', message: exception.message } },
    };
  }

  // Never leak internals (stack, SQL, provider errors) to the client.
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. The error has been logged.',
      },
    },
  };
}

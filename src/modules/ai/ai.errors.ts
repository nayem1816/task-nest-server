import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';

export type AiErrorCode =
  'AI_NOT_CONFIGURED' | 'AI_TIMEOUT' | 'AI_RATE_LIMITED' | 'AI_BAD_REQUEST' | 'AI_UNAVAILABLE';

const DETAILS: Record<AiErrorCode, { status: HttpStatus; message: string; retryable: boolean }> = {
  AI_NOT_CONFIGURED: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'AI is not set up on this server yet.',
    retryable: false,
  },
  AI_TIMEOUT: {
    status: HttpStatus.GATEWAY_TIMEOUT,
    message: 'The AI took too long to answer. Try again in a moment.',
    retryable: true,
  },
  AI_RATE_LIMITED: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'The AI provider is busy right now. Try again in a minute.',
    retryable: true,
  },
  AI_BAD_REQUEST: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'The AI provider rejected the request.',
    retryable: false,
  },
  AI_UNAVAILABLE: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'The AI provider is not responding. Try again in a moment.',
    retryable: true,
  },
};

/**
 * A provider failure, already translated from vendor errors into our terms.
 * It is an HTTP exception too, so a controller can let it propagate and the
 * client gets the friendly message; the vendor detail only reaches the logs.
 */
export class AiError extends AppException {
  constructor(
    override readonly code: AiErrorCode,
    readonly detail?: string,
  ) {
    super(DETAILS[code].status, code, DETAILS[code].message);
  }

  get retryable(): boolean {
    return DETAILS[this.code].retryable;
  }
}

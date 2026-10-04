import { HttpException, type HttpStatus } from '@nestjs/common';

/**
 * Error that carries a stable, machine-readable code. Clients branch on `code`;
 * `message` is for humans and may change wording at any time.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

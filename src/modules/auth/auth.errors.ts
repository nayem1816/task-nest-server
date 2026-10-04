import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';

export const AuthErrors = {
  invalidCredentials: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      'INVALID_CREDENTIALS',
      'That email and password combination is not right.',
    ),
  accountDisabled: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'ACCOUNT_DISABLED',
      'This account has been disabled. Contact your workspace owner.',
    ),
  emailTaken: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'EMAIL_TAKEN',
      'An account with this email already exists. Try signing in instead.',
    ),
  unauthenticated: () =>
    new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue.'),
  sessionExpired: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      'SESSION_EXPIRED',
      'Your session has ended. Sign in again.',
    ),
  refreshTokenReused: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      'SESSION_REVOKED',
      'This session was signed out for your security. Sign in again.',
    ),
  refreshInProgress: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'REFRESH_IN_PROGRESS',
      'Another tab just refreshed this session. Retry the request.',
    ),
  invalidAccountToken: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'INVALID_OR_EXPIRED_LINK',
      'This link is invalid or has expired. Request a new one.',
    ),
  wrongCurrentPassword: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'WRONG_CURRENT_PASSWORD',
      'Your current password is not right.',
    ),
  csrfHeaderMissing: () =>
    new AppException(HttpStatus.FORBIDDEN, 'CSRF_CHECK_FAILED', 'Request blocked by CSRF check.'),
};

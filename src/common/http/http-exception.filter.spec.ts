import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { AppException } from './app-exception.js';
import { toErrorBody } from './http-exception.filter.js';

describe('toErrorBody', () => {
  it('keeps the code and details of an AppException', () => {
    const { status, body } = toErrorBody(
      new AppException(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'That email is already registered.', {
        field: 'email',
      }),
    );

    expect(status).toBe(409);
    expect(body.error).toEqual({
      code: 'EMAIL_TAKEN',
      message: 'That email is already registered.',
      details: { field: 'email' },
    });
  });

  it('maps validation pipe errors to VALIDATION_FAILED with field messages', () => {
    const { status, body } = toErrorBody(
      new BadRequestException(['email must be an email', 'password is too short']),
    );

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual(['email must be an email', 'password is too short']);
  });

  it('derives a code from the status of a plain HttpException', () => {
    const { body } = toErrorBody(new NotFoundException('Conversation not found'));

    expect(body.error).toEqual({ code: 'NOT_FOUND', message: 'Conversation not found' });
  });

  it('hides the message of unknown errors', () => {
    const { status, body } = toErrorBody(new Error('relation "users" does not exist'));

    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('relation');
  });
});

describe('toErrorBody for framework exceptions', () => {
  it('replaces the throttler wording with something a person can act on', () => {
    const { status, body } = toErrorBody(
      new HttpException('ThrottlerException: Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
    );

    expect(status).toBe(429);
    expect(body.error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Wait a few minutes and try again.',
    });
  });
});

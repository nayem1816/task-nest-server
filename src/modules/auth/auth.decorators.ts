import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { AuthErrors } from './auth.errors.js';

export const IS_PUBLIC = 'auth:isPublic';

/** Opts a route out of the global access-token guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthContext {
  userId: string;
  sessionId: string;
}

/** The signed-in user and session, as set by the access-token guard. */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<Request>().auth;
  // Only reachable on a route marked @Public by mistake.
  if (!auth) throw AuthErrors.unauthenticated();
  return auth;
});

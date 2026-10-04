import type { AuthContext } from '../modules/auth/auth.decorators.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};

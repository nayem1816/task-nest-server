import type { AuthContext } from '../modules/auth/auth.decorators.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** The end user's address, see common/http/client-ip.ts. */
      clientIp?: string;
    }
  }
}

export {};

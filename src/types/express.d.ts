import type { AuthContext } from '../modules/auth/auth.decorators.js';
import type { TenantContext } from '../modules/authorization/tenant.decorators.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Set by TenantGuard on routes marked with @RequirePermissions. */
      tenant?: TenantContext;
      /** The end user's address, see common/http/client-ip.ts. */
      clientIp?: string;
    }
  }
}

export {};

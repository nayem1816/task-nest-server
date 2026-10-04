import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiForbiddenResponse, ApiSecurity } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Permission } from './permissions.js';

export const ORGANIZATION_HEADER = 'x-organization-id';
export const TENANT_METADATA = 'tenant:required';

export interface TenantContext {
  organizationId: string;
  memberId: string;
  userId: string;
  userName: string;
  roleKey: string;
  permissions: ReadonlySet<Permission>;
}

/** Name of the OpenAPI security scheme that documents the workspace header. */
export const WORKSPACE_SECURITY = 'workspace';

/**
 * Marks a route as acting inside one organization. The guard resolves the
 * organization from the `x-organization-id` header, checks the caller is an
 * active member, and that their role grants every listed permission.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(TENANT_METADATA, permissions),
    ApiSecurity(WORKSPACE_SECURITY),
    ApiForbiddenResponse({
      description:
        '`ORGANIZATION_ACCESS_DENIED`, or `PERMISSION_DENIED` when the role lacks: ' +
        (permissions.length ? permissions.map((p) => `\`${p}\``).join(', ') : 'nothing extra'),
    }),
  );

/** The organization, membership and role the request is acting as. */
export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const tenant = ctx.switchToHttp().getRequest<Request>().tenant;
  if (!tenant) {
    throw new Error('CurrentTenant used on a route without @RequirePermissions');
  }
  return tenant;
});

/** Who did it and from where; passed to services so audit entries need no request access. */
export interface RequestActor {
  organizationId: string;
  userId: string;
  memberId: string;
  label: string;
  roleKey: string;
  ip?: string;
  userAgent?: string;
}

export const Actor = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestActor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const tenant = req.tenant;
  if (!tenant) throw new Error('Actor used on a route without @RequirePermissions');
  return {
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    memberId: tenant.memberId,
    label: tenant.userName,
    roleKey: tenant.roleKey,
    ip: req.clientIp ?? req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 512),
  };
});

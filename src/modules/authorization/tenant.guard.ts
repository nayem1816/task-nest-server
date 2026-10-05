import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../../common/http/app-exception.js';
import { MemberStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { isPermission, type Permission } from './permissions.js';
import { ORGANIZATION_HEADER, TENANT_METADATA } from './tenant.decorators.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs after the access-token guard. For tenant routes it is the only place
 * that turns a client-supplied organization id into an authorized context:
 * the id is just a selector, membership is always looked up from the session's
 * user. Services receive the resolved context and never read the header.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true; // See AccessTokenGuard.

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(TENANT_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.auth) return false; // Public route marked as tenant-scoped: a programming error.

    const organizationId = req.headers[ORGANIZATION_HEADER];
    if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'ORGANIZATION_REQUIRED',
        `Send the ${ORGANIZATION_HEADER} header to choose a workspace.`,
      );
    }

    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: req.auth.userId } },
      select: {
        id: true,
        status: true,
        user: { select: { name: true } },
        role: { select: { key: true, permissions: true } },
        organization: { select: { deletedAt: true } },
      },
    });

    // Same answer whether the workspace does not exist or the user is not in
    // it, so ids of other tenants cannot be probed.
    if (!member || member.organization.deletedAt || member.status !== MemberStatus.ACTIVE) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'ORGANIZATION_ACCESS_DENIED',
        "You don't have access to this workspace.",
      );
    }

    const granted = new Set(member.role.permissions.filter(isPermission));
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'PERMISSION_DENIED',
        "Your role doesn't allow this. Ask a workspace admin if you need access.",
        { missing },
      );
    }

    req.tenant = {
      organizationId,
      memberId: member.id,
      userId: req.auth.userId,
      userName: member.user.name,
      roleKey: member.role.key,
      permissions: granted,
    };
    return true;
  }
}

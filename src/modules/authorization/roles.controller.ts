import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { isPermission, PERMISSIONS } from './permissions.js';
import { PermissionDto, RoleDto } from './roles.dto.js';
import { SYSTEM_ROLES } from './system-roles.js';
import { CurrentTenant, RequirePermissions, type TenantContext } from './tenant.decorators.js';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('roles')
  @RequirePermissions('team.read')
  @ApiOperation({ summary: 'Roles in this workspace and what each one allows' })
  @ApiOkResponse({ type: [RoleDto] })
  async list(@CurrentTenant() tenant: TenantContext): Promise<RoleDto[]> {
    const roles = await this.prisma.role.findMany({
      where: { organizationId: tenant.organizationId },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'asc' },
    });
    // System roles in their fixed order (most to least access), custom roles after.
    const rank = (key: string) => {
      const i = SYSTEM_ROLES.findIndex((r) => r.key === key);
      return i === -1 ? SYSTEM_ROLES.length : i;
    };
    roles.sort((a, b) => rank(a.key) - rank(b.key));
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions.filter(isPermission),
      memberCount: r._count.members,
    }));
  }

  @Get('permissions')
  @ApiOperation({ summary: 'Every permission a role can grant' })
  @ApiOkResponse({ type: [PermissionDto] })
  catalog(): PermissionDto[] {
    return Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description }));
  }
}

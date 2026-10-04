import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentTenant,
  RequirePermissions,
  type TenantContext,
} from '../authorization/tenant.decorators.js';
import { AuditLogPageDto, AuditQueryDto } from './audit.dto.js';
import { AuditService } from './audit.service.js';

@ApiTags('Audit log')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Who changed what in this workspace, newest first' })
  @ApiOkResponse({ type: AuditLogPageDto })
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: AuditQueryDto,
  ): Promise<AuditLogPageDto> {
    const page = await this.audit.list(tenant.organizationId, query);
    return {
      nextCursor: page.nextCursor,
      data: page.data.map((row) => ({
        id: row.id,
        actorType: row.actorType,
        actorId: row.actorId,
        actorLabel: row.actorLabel,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        ip: row.ip,
        metadata: row.metadata as Record<string, unknown> | null,
        createdAt: row.createdAt,
      })),
    };
  }
}

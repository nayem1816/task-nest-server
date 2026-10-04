import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
  CurrentTenant,
  RequirePermissions,
  type TenantContext,
} from '../authorization/tenant.decorators.js';
import { AuditService } from './audit.service.js';

class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  /** `nextCursor` from the previous page. */
  @IsOptional()
  @IsUUID()
  cursor?: string;

  /** @example "member.role_changed" */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityType?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;
}

class AuditLogDto {
  id!: string;
  actorType!: 'USER' | 'SYSTEM' | 'AI' | 'API_KEY';
  actorId!: string | null;
  actorLabel!: string | null;
  action!: string;
  entityType!: string;
  entityId!: string | null;
  ip!: string | null;
  metadata!: Record<string, unknown> | null;
  createdAt!: Date;
}

class AuditLogPageDto {
  data!: AuditLogDto[];
  nextCursor!: string | null;
}

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

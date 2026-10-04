import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class AuditQueryDto {
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

export class AuditLogDto {
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

export class AuditLogPageDto {
  data!: AuditLogDto[];
  nextCursor!: string | null;
}

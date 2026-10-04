import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { MemberStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { isPermission } from '../authorization/permissions.js';
import { SYSTEM_ROLES } from '../authorization/system-roles.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import type {
  CreateOrganizationDto,
  MyOrganizationDto,
  OrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization.dto.js';
import { slugify, withSuffix } from './slug.js';

const SLUG_ATTEMPTS = 5;

interface Creator {
  userId: string;
  name: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Creates the workspace, its system roles, and makes the creator its owner. */
  async create(creator: Creator, dto: CreateOrganizationDto): Promise<MyOrganizationDto> {
    const base = slugify(dto.name);

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? base : withSuffix(base);
      try {
        return await this.createWithSlug(creator, dto, slug);
      } catch (err) {
        const slugTaken =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          JSON.stringify(err.meta ?? {}).includes('slug');
        if (!slugTaken) throw err;
      }
    }
    throw new Error(`Could not find a free slug for "${base}"`);
  }

  private createWithSlug(creator: Creator, dto: CreateOrganizationDto, slug: string) {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.name,
          slug,
          businessType: dto.businessType,
          timezone: dto.timezone ?? 'UTC',
          roles: {
            create: SYSTEM_ROLES.map((role) => ({
              key: role.key,
              name: role.name,
              description: role.description,
              permissions: [...role.permissions],
              isSystem: true,
            })),
          },
        },
        include: { roles: true },
      });

      const owner = organization.roles.find((r) => r.key === 'owner')!;
      const member = await tx.organizationMember.create({
        data: { organizationId: organization.id, userId: creator.userId, roleId: owner.id },
      });

      await this.audit.record(
        {
          organizationId: organization.id,
          userId: creator.userId,
          memberId: member.id,
          label: creator.name,
          roleKey: 'owner',
          ip: creator.ip,
          userAgent: creator.userAgent,
        },
        { action: 'organization.created', entityType: 'organization', entityId: organization.id },
        tx,
      );

      return {
        ...toOrganizationDto(organization),
        memberId: member.id,
        role: { key: owner.key, name: owner.name },
        permissions: owner.permissions,
      };
    });
  }

  async listForUser(userId: string): Promise<MyOrganizationDto[]> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId, status: MemberStatus.ACTIVE, organization: { deletedAt: null } },
      include: { organization: true, role: true },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => ({
      ...toOrganizationDto(m.organization),
      memberId: m.id,
      role: { key: m.role.key, name: m.role.name },
      permissions: m.role.permissions.filter(isPermission),
    }));
  }

  async get(organizationId: string): Promise<OrganizationDto> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    return toOrganizationDto(organization);
  }

  async update(actor: RequestActor, dto: UpdateOrganizationDto): Promise<OrganizationDto> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
      });
      const after = await tx.organization.update({
        where: { id: actor.organizationId },
        data: dto,
      });

      const changes = changedFields(before, after, ['name', 'businessType', 'timezone']);
      if (Object.keys(changes).length > 0) {
        await this.audit.record(
          actor,
          {
            action: 'organization.updated',
            entityType: 'organization',
            entityId: after.id,
            metadata: changes,
          },
          tx,
        );
      }
      return toOrganizationDto(after);
    });
  }
}

function toOrganizationDto(org: {
  id: string;
  name: string;
  slug: string;
  businessType: string | null;
  timezone: string;
  createdAt: Date;
}): OrganizationDto {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    businessType: org.businessType,
    timezone: org.timezone,
    createdAt: org.createdAt,
  };
}

/** `{ field: { from, to } }` for the fields that actually changed. */
function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T & string)[],
): Record<string, { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }> {
  const changes: Record<
    string,
    { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }
  > = {};
  for (const field of fields) {
    if (before[field] !== after[field]) {
      changes[field] = {
        from: before[field] ?? null,
        to: after[field] ?? null,
      };
    }
  }
  return changes;
}

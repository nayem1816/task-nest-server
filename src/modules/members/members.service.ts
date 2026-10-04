import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';
import { MemberStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import type { MemberDto, UpdateMemberDto } from './members.dto.js';

const OWNER = 'owner';

const errors = {
  notFound: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      'MEMBER_NOT_FOUND',
      'That member is not in this workspace.',
    ),
  self: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'CANNOT_CHANGE_SELF',
      'You cannot change your own role or access. Ask another admin.',
    ),
  ownerOnly: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'OWNER_ONLY',
      'Only an owner can grant the owner role or change another owner.',
    ),
  roleNotFound: () =>
    new AppException(HttpStatus.BAD_REQUEST, 'ROLE_NOT_FOUND', 'That role does not exist here.'),
};

const memberInclude = {
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
  role: { select: { id: true, key: true, name: true } },
  teams: { select: { team: { select: { id: true, name: true } } } },
} as const;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<MemberDto[]> {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: memberInclude,
      orderBy: [{ status: 'asc' }, { joinedAt: 'asc' }],
    });
    return members.map(toMemberDto);
  }

  async update(actor: RequestActor, memberId: string, dto: UpdateMemberDto): Promise<MemberDto> {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.organizationMember.findFirst({
        where: { id: memberId, organizationId: actor.organizationId },
        include: memberInclude,
      });
      if (!member) throw errors.notFound();
      if (member.id === actor.memberId) throw errors.self();
      if (member.role.key === OWNER && actor.roleKey !== OWNER) throw errors.ownerOnly();

      let roleId = member.roleId;
      if (dto.roleId && dto.roleId !== member.roleId) {
        const role = await tx.role.findFirst({
          where: { id: dto.roleId, organizationId: actor.organizationId },
        });
        if (!role) throw errors.roleNotFound();
        if (role.key === OWNER && actor.roleKey !== OWNER) throw errors.ownerOnly();
        roleId = role.id;

        await this.audit.record(
          actor,
          {
            action: 'member.role_changed',
            entityType: 'member',
            entityId: member.id,
            metadata: { member: member.user.email, from: member.role.key, to: role.key },
          },
          tx,
        );
      }

      if (dto.status && dto.status !== member.status) {
        await this.audit.record(
          actor,
          {
            action: dto.status === MemberStatus.DISABLED ? 'member.disabled' : 'member.enabled',
            entityType: 'member',
            entityId: member.id,
            metadata: { member: member.user.email },
          },
          tx,
        );
      }

      const updated = await tx.organizationMember.update({
        where: { id: member.id },
        data: { roleId, status: dto.status },
        include: memberInclude,
      });
      return toMemberDto(updated);
    });
  }

  async remove(actor: RequestActor, memberId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const member = await tx.organizationMember.findFirst({
        where: { id: memberId, organizationId: actor.organizationId },
        include: memberInclude,
      });
      if (!member) throw errors.notFound();
      if (member.id === actor.memberId) throw errors.self();
      if (member.role.key === OWNER && actor.roleKey !== OWNER) throw errors.ownerOnly();

      await tx.organizationMember.delete({ where: { id: member.id } });
      await this.audit.record(
        actor,
        {
          action: 'member.removed',
          entityType: 'member',
          entityId: member.id,
          metadata: { member: member.user.email, name: member.user.name, role: member.role.key },
        },
        tx,
      );
    });
  }
}

type MemberRow = {
  id: string;
  status: MemberStatus;
  displayName: string | null;
  joinedAt: Date;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
  role: { id: string; key: string; name: string };
  teams: { team: { id: string; name: string } }[];
};

function toMemberDto(m: MemberRow): MemberDto {
  return {
    id: m.id,
    status: m.status,
    displayName: m.displayName,
    joinedAt: m.joinedAt,
    user: m.user,
    role: m.role,
    teams: m.teams.map((t) => t.team),
  };
}

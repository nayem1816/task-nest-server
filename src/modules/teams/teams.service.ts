import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import type { CreateTeamDto, SetTeamMembersDto, TeamDto, UpdateTeamDto } from './teams.dto.js';

const errors = {
  notFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'TEAM_NOT_FOUND', 'That team does not exist.'),
  nameTaken: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'TEAM_NAME_TAKEN',
      'A team with this name already exists.',
    ),
  foreignMembers: (ids: string[]) =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'MEMBER_NOT_IN_ORGANIZATION',
      'Some of those people are not members of this workspace.',
      { memberIds: ids },
    ),
};

const teamInclude = {
  members: {
    select: {
      member: { select: { id: true, displayName: true, user: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.TeamInclude;

type TeamRow = Prisma.TeamGetPayload<{ include: typeof teamInclude }>;

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<TeamDto[]> {
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      include: teamInclude,
      orderBy: { name: 'asc' },
    });
    return teams.map(toTeamDto);
  }

  async create(actor: RequestActor, dto: CreateTeamDto): Promise<TeamDto> {
    return this.withNameCheck(() =>
      this.prisma.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: { ...dto, organizationId: actor.organizationId },
          include: teamInclude,
        });
        await this.audit.record(
          actor,
          {
            action: 'team.created',
            entityType: 'team',
            entityId: team.id,
            metadata: { name: team.name },
          },
          tx,
        );
        return toTeamDto(team);
      }),
    );
  }

  async update(actor: RequestActor, teamId: string, dto: UpdateTeamDto): Promise<TeamDto> {
    return this.withNameCheck(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.findOwned(tx, actor.organizationId, teamId);
        const team = await tx.team.update({
          where: { id: before.id },
          data: dto,
          include: teamInclude,
        });
        await this.audit.record(
          actor,
          {
            action: 'team.updated',
            entityType: 'team',
            entityId: team.id,
            metadata: { name: { from: before.name, to: team.name } },
          },
          tx,
        );
        return toTeamDto(team);
      }),
    );
  }

  async remove(actor: RequestActor, teamId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const team = await this.findOwned(tx, actor.organizationId, teamId);
      await tx.team.delete({ where: { id: team.id } });
      await this.audit.record(
        actor,
        {
          action: 'team.deleted',
          entityType: 'team',
          entityId: team.id,
          metadata: { name: team.name },
        },
        tx,
      );
    });
  }

  /**
   * Replaces the team's members. The foreign key only says each id is a
   * membership; this is where we check they belong to the same organization.
   */
  async setMembers(actor: RequestActor, teamId: string, dto: SetTeamMembersDto): Promise<TeamDto> {
    const wanted = [...new Set(dto.memberIds)];

    return this.prisma.$transaction(async (tx) => {
      const team = await this.findOwned(tx, actor.organizationId, teamId);

      const valid = await tx.organizationMember.findMany({
        where: { id: { in: wanted }, organizationId: actor.organizationId },
        select: { id: true },
      });
      if (valid.length !== wanted.length) {
        const validIds = new Set(valid.map((m) => m.id));
        throw errors.foreignMembers(wanted.filter((id) => !validIds.has(id)));
      }

      const current = await tx.teamMember.findMany({
        where: { teamId },
        select: { memberId: true },
      });
      const currentIds = new Set(current.map((c) => c.memberId));
      const added = wanted.filter((id) => !currentIds.has(id));
      const removed = [...currentIds].filter((id) => !wanted.includes(id));

      if (removed.length > 0) {
        await tx.teamMember.deleteMany({ where: { teamId, memberId: { in: removed } } });
      }
      if (added.length > 0) {
        await tx.teamMember.createMany({ data: added.map((memberId) => ({ teamId, memberId })) });
      }
      if (added.length > 0 || removed.length > 0) {
        await this.audit.record(
          actor,
          {
            action: 'team.members_changed',
            entityType: 'team',
            entityId: team.id,
            metadata: { added, removed },
          },
          tx,
        );
      }

      const updated = await tx.team.findUniqueOrThrow({
        where: { id: team.id },
        include: teamInclude,
      });
      return toTeamDto(updated);
    });
  }

  private async findOwned(tx: Prisma.TransactionClient, organizationId: string, teamId: string) {
    const team = await tx.team.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw errors.notFound();
    return team;
  }

  private async withNameCheck<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw errors.nameTaken();
      }
      throw err;
    }
  }
}

function toTeamDto(team: TeamRow): TeamDto {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    createdAt: team.createdAt,
    members: team.members.map(({ member }) => ({
      id: member.id,
      name: member.displayName ?? member.user.name,
    })),
  };
}

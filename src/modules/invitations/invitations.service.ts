import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { generateOpaqueToken, hashOpaqueToken } from '../../common/crypto/opaque-token.js';
import { AppException } from '../../common/http/app-exception.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MemberStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { MailService } from '../../infrastructure/mail/mail.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import type {
  CreateInvitationDto,
  InvitationDto,
  InvitationPreviewDto,
} from './invitations.dto.js';
import { invitationEmail } from './invitation-email.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const errors = {
  roleNotFound: () =>
    new AppException(HttpStatus.BAD_REQUEST, 'ROLE_NOT_FOUND', 'That role does not exist here.'),
  ownerOnly: () =>
    new AppException(HttpStatus.FORBIDDEN, 'OWNER_ONLY', 'Only an owner can invite another owner.'),
  alreadyMember: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ALREADY_MEMBER',
      'That person is already a member of this workspace.',
    ),
  notFound: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      'INVITATION_NOT_FOUND',
      'That invitation does not exist.',
    ),
  invalidLink: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'INVALID_OR_EXPIRED_LINK',
      'This invitation is no longer valid. Ask for a new one.',
    ),
  emailMismatch: (email: string) =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'INVITATION_EMAIL_MISMATCH',
      `This invitation is for ${email}. Sign in with that address to accept it.`,
    ),
};

const pendingWhere = (now: Date) =>
  ({
    acceptedAt: null,
    revokedAt: null,
    expiresAt: { gt: now },
  }) satisfies Prisma.InvitationWhereInput;

@Injectable()
export class InvitationsService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(InvitationsService.name);
    this.appUrl = config.get('APP_URL', { infer: true });
  }

  /** Inviting an address that already has a pending invitation replaces it. */
  async create(actor: RequestActor, dto: CreateInvitationDto): Promise<InvitationDto> {
    const token = generateOpaqueToken();

    const { invitation, organizationName } = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findFirst({
        where: { id: dto.roleId, organizationId: actor.organizationId },
      });
      if (!role) throw errors.roleNotFound();
      if (role.key === 'owner' && actor.roleKey !== 'owner') throw errors.ownerOnly();

      const existing = await tx.organizationMember.findFirst({
        where: { organizationId: actor.organizationId, user: { email: dto.email } },
        select: { id: true },
      });
      if (existing) throw errors.alreadyMember();

      const now = new Date();
      await tx.invitation.updateMany({
        where: { organizationId: actor.organizationId, email: dto.email, ...pendingWhere(now) },
        data: { revokedAt: now },
      });

      const invitation = await tx.invitation.create({
        data: {
          organizationId: actor.organizationId,
          email: dto.email,
          roleId: role.id,
          invitedById: actor.userId,
          tokenHash: hashOpaqueToken(token),
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        },
        include: { role: true, invitedBy: { select: { name: true } }, organization: true },
      });

      await this.audit.record(
        actor,
        {
          action: 'invitation.sent',
          entityType: 'invitation',
          entityId: invitation.id,
          metadata: { email: invitation.email, role: role.key },
        },
        tx,
      );
      return { invitation, organizationName: invitation.organization.name };
    });

    const link = new URL('/invite', this.appUrl);
    link.searchParams.set('token', token);
    await this.mail
      .send(
        'invitation',
        invitationEmail({
          to: invitation.email,
          inviterName: actor.label,
          organizationName,
          roleName: invitation.role.name,
          link: link.toString(),
        }),
        `invitation-${invitation.id}`,
      )
      .catch((err: unknown) =>
        // The invitation exists; the admin can resend from the members page.
        this.logger.error({ err, invitationId: invitation.id }, 'Could not queue invitation email'),
      );

    return toInvitationDto(invitation);
  }

  async listPending(organizationId: string): Promise<InvitationDto[]> {
    const invitations = await this.prisma.invitation.findMany({
      where: { organizationId, ...pendingWhere(new Date()) },
      include: { role: true, invitedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map(toInvitationDto);
  }

  async revoke(actor: RequestActor, invitationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.findFirst({
        where: {
          id: invitationId,
          organizationId: actor.organizationId,
          ...pendingWhere(new Date()),
        },
      });
      if (!invitation) throw errors.notFound();

      await tx.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
      await this.audit.record(
        actor,
        {
          action: 'invitation.revoked',
          entityType: 'invitation',
          entityId: invitation.id,
          metadata: { email: invitation.email },
        },
        tx,
      );
    });
  }

  async preview(token: string): Promise<InvitationPreviewDto> {
    const invitation = await this.findValid(token);
    return {
      organizationName: invitation.organization.name,
      invitedBy: invitation.invitedBy?.name ?? null,
      email: invitation.email,
      roleName: invitation.role.name,
      expiresAt: invitation.expiresAt,
    };
  }

  /** Returns the organization id the user now belongs to. */
  async accept(userId: string, token: string, client: { ip?: string; userAgent?: string }) {
    const invitation = await this.findValid(token);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw errors.emailMismatch(invitation.email);
      }

      // Conditional update so a double-click cannot accept twice.
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw errors.invalidLink();

      const member = await tx.organizationMember.upsert({
        where: {
          organizationId_userId: { organizationId: invitation.organizationId, userId },
        },
        update: { status: MemberStatus.ACTIVE, roleId: invitation.roleId },
        create: { organizationId: invitation.organizationId, userId, roleId: invitation.roleId },
      });

      // The invitation reached this inbox, which is proof of the address.
      if (!user.emailVerifiedAt) {
        await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      }

      await this.audit.record(
        {
          organizationId: invitation.organizationId,
          userId,
          memberId: member.id,
          label: user.name,
          roleKey: invitation.role.key,
          ...client,
        },
        {
          action: 'invitation.accepted',
          entityType: 'invitation',
          entityId: invitation.id,
          metadata: { email: invitation.email, role: invitation.role.key },
        },
        tx,
      );
      return { organizationId: invitation.organizationId };
    });
  }

  private async findValid(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: { organization: true, role: true, invitedBy: { select: { name: true } } },
    });
    const now = new Date();
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= now ||
      invitation.organization.deletedAt
    ) {
      throw errors.invalidLink();
    }
    return invitation;
  }
}

function toInvitationDto(invitation: {
  id: string;
  email: string;
  expiresAt: Date;
  createdAt: Date;
  role: { id: string; key: string; name: string };
  invitedBy: { name: string } | null;
}): InvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    role: { id: invitation.role.id, key: invitation.role.key, name: invitation.role.name },
    invitedBy: invitation.invitedBy?.name ?? null,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}

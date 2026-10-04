import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import type { CreateTagDto, TagDto, TagWithUsageDto, UpdateTagDto } from './contacts.dto.js';

const errors = {
  notFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'TAG_NOT_FOUND', 'That tag does not exist.'),
  nameTaken: () =>
    new AppException(HttpStatus.CONFLICT, 'TAG_NAME_TAKEN', 'A tag with this name already exists.'),
};

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<TagWithUsageDto[]> {
    const tags = await this.prisma.tag.findMany({
      where: { organizationId },
      include: { _count: { select: { contacts: true } } },
      orderBy: { name: 'asc' },
    });
    return tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      contactCount: t._count.contacts,
    }));
  }

  async create(actor: RequestActor, dto: CreateTagDto): Promise<TagDto> {
    return this.withNameCheck(async () => {
      const tag = await this.prisma.tag.create({
        data: { organizationId: actor.organizationId, name: dto.name, color: dto.color },
      });
      return { id: tag.id, name: tag.name, color: tag.color };
    });
  }

  async update(actor: RequestActor, tagId: string, dto: UpdateTagDto): Promise<TagDto> {
    return this.withNameCheck(async () => {
      const existing = await this.prisma.tag.findFirst({
        where: { id: tagId, organizationId: actor.organizationId },
      });
      if (!existing) throw errors.notFound();
      const tag = await this.prisma.tag.update({ where: { id: existing.id }, data: dto });
      return { id: tag.id, name: tag.name, color: tag.color };
    });
  }

  /** Removes the tag everywhere it is used, so it is audited. */
  async remove(actor: RequestActor, tagId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const tag = await tx.tag.findFirst({
        where: { id: tagId, organizationId: actor.organizationId },
        include: { _count: { select: { contacts: true } } },
      });
      if (!tag) throw errors.notFound();
      await tx.tag.delete({ where: { id: tag.id } });
      await this.audit.record(
        actor,
        {
          action: 'tag.deleted',
          entityType: 'tag',
          entityId: tag.id,
          metadata: { name: tag.name, contacts: tag._count.contacts },
        },
        tx,
      );
    });
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

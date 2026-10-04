import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import { ContactActivityService } from './contact-activity.service.js';
import type { NoteDto } from './contacts.dto.js';

const errors = {
  contactNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'CONTACT_NOT_FOUND', 'That contact does not exist.'),
  noteNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'NOTE_NOT_FOUND', 'That note does not exist.'),
  notYours: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'NOTE_NOT_YOURS',
      'Only the author or someone who can delete contacts can remove this note.',
    ),
};

const noteInclude = {
  author: { select: { id: true, displayName: true, user: { select: { name: true } } } },
} as const;

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ContactActivityService,
  ) {}

  async list(organizationId: string, contactId: string, limit: number, cursor?: string) {
    await this.assertContact(organizationId, contactId);
    const rows = await this.prisma.contactNote.findMany({
      where: { organizationId, contactId, ...(cursor && { id: { lt: cursor } }) },
      include: noteInclude,
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows).map(toNoteDto);
    return { data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
  }

  async create(actor: RequestActor, contactId: string, body: string): Promise<NoteDto> {
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, organizationId: actor.organizationId },
        select: { id: true },
      });
      if (!contact) throw errors.contactNotFound();

      const note = await tx.contactNote.create({
        data: { organizationId: actor.organizationId, contactId, authorId: actor.memberId, body },
        include: noteInclude,
      });
      await this.activity.record(
        {
          organizationId: actor.organizationId,
          contactId,
          type: 'note.added',
          actor: { id: actor.userId, label: actor.label },
          metadata: { noteId: note.id, excerpt: excerpt(body) },
        },
        tx,
      );
      return toNoteDto(note);
    });
  }

  async remove(actor: RequestActor, contactId: string, noteId: string, canDeleteAny: boolean) {
    const note = await this.prisma.contactNote.findFirst({
      where: { id: noteId, contactId, organizationId: actor.organizationId },
    });
    if (!note) throw errors.noteNotFound();
    if (note.authorId !== actor.memberId && !canDeleteAny) throw errors.notYours();
    await this.prisma.contactNote.delete({ where: { id: note.id } });
  }

  private async assertContact(organizationId: string, contactId: string) {
    const found = await this.prisma.contact.count({ where: { id: contactId, organizationId } });
    if (found === 0) throw errors.contactNotFound();
  }
}

function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

function toNoteDto(note: {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; displayName: string | null; user: { name: string } } | null;
}): NoteDto {
  return {
    id: note.id,
    body: note.body,
    createdAt: note.createdAt,
    author: note.author
      ? { id: note.author.id, name: note.author.displayName ?? note.author.user.name }
      : null,
  };
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import { ContactActivityService } from './contact-activity.service.js';
import type {
  ContactDetailDto,
  ContactDto,
  ContactFieldsDto,
  CreateContactDto,
  ListContactsQueryDto,
  UpdateContactDto,
} from './contacts.dto.js';

const errors = {
  notFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'CONTACT_NOT_FOUND', 'That contact does not exist.'),
  emailTaken: (contactId: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'CONTACT_EMAIL_TAKEN',
      'Another contact already uses this email.',
      { contactId },
    ),
  empty: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'CONTACT_NEEDS_IDENTITY',
      'Give the contact at least a name, email or phone number.',
    ),
  unknownTags: () =>
    new AppException(HttpStatus.BAD_REQUEST, 'TAG_NOT_FOUND', 'Some of those tags do not exist.'),
};

const listInclude = {
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} as const satisfies Prisma.ContactInclude;

type ContactRow = Prisma.ContactGetPayload<{ include: typeof listInclude }>;

const EDITABLE_FIELDS = ['name', 'email', 'phone', 'company', 'location', 'stage'] as const;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ContactActivityService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, query: ListContactsQueryDto) {
    const search = query.search?.trim();
    const rows = await this.prisma.contact.findMany({
      where: {
        organizationId,
        stage: query.stage,
        ...(query.tagId && { tags: { some: { tagId: query.tagId } } }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { company: { contains: search, mode: 'insensitive' } },
          ],
        }),
        ...(query.cursor && { id: { lt: query.cursor } }),
      },
      include: listInclude,
      // UUIDv7 ids sort by creation time, so newest first is also a stable cursor.
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const data = (hasMore ? rows.slice(0, query.limit) : rows).map(toContactDto);
    return { data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
  }

  async get(organizationId: string, contactId: string): Promise<ContactDetailDto> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId },
      include: {
        ...listInclude,
        identities: { select: { channel: true, externalId: true }, orderBy: { createdAt: 'asc' } },
        _count: { select: { notes: true } },
      },
    });
    if (!contact) throw errors.notFound();
    return {
      ...toContactDto(contact),
      identities: contact.identities,
      noteCount: contact._count.notes,
    };
  }

  async create(actor: RequestActor, dto: CreateContactDto): Promise<ContactDetailDto> {
    if (!dto.name && !dto.email && !dto.phone) throw errors.empty();

    const contact = await this.withEmailCheck(actor.organizationId, dto.email, () =>
      this.prisma.$transaction(async (tx) => {
        const tagIds = await this.validTagIds(tx, actor.organizationId, dto.tagIds ?? []);
        const created = await tx.contact.create({
          data: {
            organizationId: actor.organizationId,
            ...pickFields(dto),
            tags: { create: tagIds.map((tagId) => ({ tagId })) },
            identities: {
              create: [
                ...(dto.email
                  ? [
                      {
                        organizationId: actor.organizationId,
                        channel: 'EMAIL' as const,
                        externalId: dto.email.toLowerCase(),
                      },
                    ]
                  : []),
                ...(dto.phone
                  ? [
                      {
                        organizationId: actor.organizationId,
                        channel: 'PHONE' as const,
                        externalId: normalizePhone(dto.phone),
                      },
                    ]
                  : []),
              ],
            },
          },
        });
        await this.activity.record(
          {
            organizationId: actor.organizationId,
            contactId: created.id,
            type: 'contact.created',
            actor: { id: actor.userId, label: actor.label },
            metadata: { source: 'manual' },
          },
          tx,
        );
        return created;
      }),
    );
    return this.get(actor.organizationId, contact.id);
  }

  async update(
    actor: RequestActor,
    contactId: string,
    dto: UpdateContactDto,
  ): Promise<ContactDetailDto> {
    await this.withEmailCheck(actor.organizationId, dto.email, () =>
      this.prisma.$transaction(async (tx) => {
        const before = await tx.contact.findFirst({
          where: { id: contactId, organizationId: actor.organizationId },
        });
        if (!before) throw errors.notFound();

        const fields = pickFields(dto);
        const after = { ...before, ...fields };
        if (!after.name && !after.email && !after.phone) throw errors.empty();

        const changed = EDITABLE_FIELDS.filter((f) => f in fields && before[f] !== after[f]);
        if (changed.length === 0) return;

        await tx.contact.update({ where: { id: before.id }, data: fields });
        if (changed.includes('email')) {
          await syncIdentity(tx, before, 'EMAIL', before.email, after.email);
        }
        if (changed.includes('phone')) {
          await syncIdentity(tx, before, 'PHONE', before.phone, after.phone);
        }

        const actorRef = { id: actor.userId, label: actor.label };
        if (changed.includes('stage')) {
          await this.activity.record(
            {
              organizationId: actor.organizationId,
              contactId: before.id,
              type: 'stage.changed',
              actor: actorRef,
              metadata: { from: before.stage, to: after.stage },
            },
            tx,
          );
        }
        const details = changed.filter((f) => f !== 'stage');
        if (details.length > 0) {
          await this.activity.record(
            {
              organizationId: actor.organizationId,
              contactId: before.id,
              type: 'contact.updated',
              actor: actorRef,
              metadata: { fields: details },
            },
            tx,
          );
        }
      }),
    );
    return this.get(actor.organizationId, contactId);
  }

  async remove(actor: RequestActor, contactId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, organizationId: actor.organizationId },
      });
      if (!contact) throw errors.notFound();

      await tx.contact.delete({ where: { id: contact.id } });
      await this.audit.record(
        actor,
        {
          action: 'contact.deleted',
          entityType: 'contact',
          entityId: contact.id,
          metadata: { name: contact.name, email: contact.email },
        },
        tx,
      );
    });
  }

  async setTags(
    actor: RequestActor,
    contactId: string,
    tagIds: string[],
  ): Promise<ContactDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, organizationId: actor.organizationId },
        include: { tags: { include: { tag: true } } },
      });
      if (!contact) throw errors.notFound();

      const wanted = await this.validTagIds(tx, actor.organizationId, tagIds);
      const current = new Map(contact.tags.map((t) => [t.tagId, t.tag.name]));
      const added = wanted.filter((id) => !current.has(id));
      const removed = [...current.keys()].filter((id) => !wanted.includes(id));
      if (added.length === 0 && removed.length === 0) return;

      if (removed.length > 0) {
        await tx.contactTag.deleteMany({ where: { contactId, tagId: { in: removed } } });
      }
      if (added.length > 0) {
        await tx.contactTag.createMany({ data: added.map((tagId) => ({ contactId, tagId })) });
      }

      const addedNames = (
        await tx.tag.findMany({ where: { id: { in: added } }, select: { name: true } })
      ).map((t) => t.name);
      await this.activity.record(
        {
          organizationId: actor.organizationId,
          contactId,
          type: 'tags.changed',
          actor: { id: actor.userId, label: actor.label },
          metadata: { added: addedNames, removed: removed.map((id) => current.get(id)!) },
        },
        tx,
      );
    });
    return this.get(actor.organizationId, contactId);
  }

  /** Tags must exist and belong to this workspace. Duplicates are dropped. */
  private async validTagIds(
    tx: Prisma.TransactionClient,
    organizationId: string,
    tagIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return [];
    const found = await tx.tag.count({ where: { id: { in: unique }, organizationId } });
    if (found !== unique.length) throw errors.unknownTags();
    return unique;
  }

  /** Turns the unique-email violation into a 409 that points at the existing contact. */
  private async withEmailCheck<T>(
    organizationId: string,
    email: string | null | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && email) {
        const existing = await this.prisma.contact.findFirst({
          where: { organizationId, email },
          select: { id: true },
        });
        throw errors.emailTaken(existing?.id ?? '');
      }
      throw err;
    }
  }
}

function pickFields(dto: ContactFieldsDto) {
  const fields: Partial<Record<(typeof EDITABLE_FIELDS)[number], unknown>> = {};
  for (const key of EDITABLE_FIELDS) {
    if (dto[key] !== undefined) fields[key] = dto[key];
  }
  return fields as Prisma.ContactUncheckedUpdateInput & Partial<Prisma.ContactUncheckedCreateInput>;
}

/**
 * Keeps the EMAIL / PHONE identity in step with the field, so inbound messages
 * from the new address land on this contact and the old address no longer does.
 */
async function syncIdentity(
  tx: Prisma.TransactionClient,
  contact: { id: string; organizationId: string },
  channel: 'EMAIL' | 'PHONE',
  from: string | null,
  to: string | null,
) {
  const key = (value: string) =>
    channel === 'EMAIL' ? value.toLowerCase() : normalizePhone(value);
  if (from) {
    await tx.contactIdentity.deleteMany({
      where: { contactId: contact.id, channel, externalId: key(from) },
    });
  }
  if (to) {
    await tx.contactIdentity.create({
      data: {
        organizationId: contact.organizationId,
        contactId: contact.id,
        channel,
        externalId: key(to),
      },
    });
  }
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export function displayName(c: {
  name: string | null;
  email: string | null;
  phone: string | null;
}) {
  return c.name ?? c.email ?? c.phone ?? 'Unknown contact';
}

export function toContactDto(c: ContactRow): ContactDto {
  return {
    id: c.id,
    displayName: displayName(c),
    name: c.name,
    email: c.email,
    phone: c.phone,
    company: c.company,
    location: c.location,
    stage: c.stage,
    lastSeenAt: c.lastSeenAt,
    createdAt: c.createdAt,
    tags: c.tags.map((t) => t.tag),
  };
}

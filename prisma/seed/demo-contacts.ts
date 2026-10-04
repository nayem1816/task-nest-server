import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { LifecycleStage } from '../../src/generated/prisma/enums.js';

const TAGS = [
  { name: 'Subscriber', color: 'teal' },
  { name: 'Wholesale', color: 'violet' },
  { name: 'VIP', color: 'amber' },
  { name: 'Gift order', color: 'pink' },
  { name: 'Refund requested', color: 'red' },
  { name: 'Newsletter', color: 'blue' },
];

interface SeedContact {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  location?: string;
  stage: LifecycleStage;
  tags: string[];
  /** Days since the contact was last active. */
  seenDaysAgo?: number;
  notes?: { by: string; body: string }[];
}

const CONTACTS: SeedContact[] = [
  {
    name: 'Sarah Mitchell',
    email: 'sarah.mitchell@gmail.com',
    phone: '+1 512 555 0143',
    location: 'Austin, TX',
    stage: 'CUSTOMER',
    tags: ['Subscriber', 'VIP'],
    seenDaysAgo: 0,
    notes: [
      {
        by: 'tom@northstarcoffee.co',
        body: 'Prefers whole bean, never ground. Swapped her subscription to the Ethiopia Guji in August.',
      },
    ],
  },
  {
    name: 'James Okoro',
    email: 'james.okoro@outlook.com',
    location: 'Chicago, IL',
    stage: 'CUSTOMER',
    tags: ['Subscriber'],
    seenDaysAgo: 2,
  },
  {
    name: 'Hannah Lindqvist',
    email: 'hannah@lindqvistdesign.se',
    company: 'Lindqvist Design',
    location: 'Stockholm, Sweden',
    stage: 'CUSTOMER',
    tags: ['Gift order'],
    seenDaysAgo: 9,
    notes: [
      {
        by: 'lucia@northstarcoffee.co',
        body: 'Ordered 12 gift boxes for her studio clients. Asked if we can add a printed card next time. We can, for orders over 10 boxes.',
      },
    ],
  },
  {
    name: 'Marcus Bell',
    email: 'marcus@thedailygrindcafe.com',
    phone: '+1 312 555 0187',
    company: 'The Daily Grind Café',
    location: 'Chicago, IL',
    stage: 'CUSTOMER',
    tags: ['Wholesale', 'VIP'],
    seenDaysAgo: 1,
    notes: [
      {
        by: 'sam@northstarcoffee.co',
        body: 'Two locations, ~40 lb a week of the house espresso. Renewing the wholesale agreement in November; wants to talk about a decaf option.',
      },
    ],
  },
  {
    name: 'Priscilla Nguyen',
    email: 'pnguyen@brightlinehq.com',
    company: 'Brightline',
    location: 'Denver, CO',
    stage: 'LEAD',
    tags: ['Wholesale'],
    seenDaysAgo: 4,
    notes: [
      {
        by: 'sam@northstarcoffee.co',
        body: 'Office manager for ~120 people. Currently on pods, looking at batch brewers. Sent the office price sheet on Tuesday.',
      },
    ],
  },
  {
    name: 'Daniel Reyes',
    email: 'danreyes88@gmail.com',
    location: 'San Antonio, TX',
    stage: 'CUSTOMER',
    tags: ['Refund requested'],
    seenDaysAgo: 3,
    notes: [
      {
        by: 'tom@northstarcoffee.co',
        body: 'Bag arrived with a split seam. Sent a replacement and told him not to bother returning the old one.',
      },
    ],
  },
  {
    name: 'Emily Carter',
    email: 'emily.carter@icloud.com',
    location: 'Portland, OR',
    stage: 'CUSTOMER',
    tags: ['Subscriber', 'Newsletter'],
    seenDaysAgo: 6,
  },
  {
    name: 'Ravi Shankar',
    email: 'ravi.s@protonmail.com',
    location: 'Seattle, WA',
    stage: 'CUSTOMER',
    tags: ['Newsletter'],
    seenDaysAgo: 15,
  },
  {
    name: 'Olivia Brooks',
    email: 'olivia.brooks@gmail.com',
    location: 'Nashville, TN',
    stage: 'CUSTOMER',
    tags: ['Gift order'],
    seenDaysAgo: 30,
  },
  {
    name: 'Tomás Herrera',
    email: 'tomas@herreraroasting.mx',
    company: 'Herrera Roasting',
    location: 'Oaxaca, Mexico',
    stage: 'LEAD',
    tags: ['Wholesale'],
    seenDaysAgo: 11,
  },
  {
    name: 'Grace Kim',
    email: 'gracekim.ny@gmail.com',
    location: 'Brooklyn, NY',
    stage: 'CUSTOMER',
    tags: ['Subscriber'],
    seenDaysAgo: 0,
  },
  {
    name: 'Ben Fischer',
    email: 'ben.fischer@gmx.de',
    location: 'Berlin, Germany',
    stage: 'VISITOR',
    tags: [],
    seenDaysAgo: 1,
  },
  { email: 'kpatel.home@yahoo.com', stage: 'VISITOR', tags: ['Newsletter'], seenDaysAgo: 5 },
  {
    name: 'Aisha Mohammed',
    email: 'aisha.mohammed@gmail.com',
    location: 'Minneapolis, MN',
    stage: 'CUSTOMER',
    tags: ['Subscriber'],
    seenDaysAgo: 8,
  },
  {
    name: 'Chloe Martin',
    email: 'chloe@northfieldyoga.com',
    company: 'Northfield Yoga',
    location: 'Madison, WI',
    stage: 'LEAD',
    tags: ['Wholesale'],
    seenDaysAgo: 2,
  },
  {
    name: 'Ethan Walker',
    email: 'ewalker@fastmail.com',
    location: 'Boulder, CO',
    stage: 'CUSTOMER',
    tags: [],
    seenDaysAgo: 45,
  },
  {
    name: 'Mia Rossi',
    email: 'mia.rossi@gmail.com',
    location: 'Philadelphia, PA',
    stage: 'CUSTOMER',
    tags: ['VIP', 'Subscriber'],
    seenDaysAgo: 3,
  },
  { phone: '+1 773 555 0119', stage: 'VISITOR', tags: [], seenDaysAgo: 0 },
  {
    name: 'Noah Thompson',
    email: 'noah.t@gmail.com',
    location: 'Columbus, OH',
    stage: 'VISITOR',
    tags: [],
    seenDaysAgo: 12,
  },
  {
    name: 'Isabella Cruz',
    email: 'isabella.cruz@hotmail.com',
    location: 'Miami, FL',
    stage: 'CUSTOMER',
    tags: ['Gift order', 'Newsletter'],
    seenDaysAgo: 21,
  },
  {
    name: 'Leo Andersson',
    email: 'leo@fikahouse.co',
    phone: '+1 206 555 0164',
    company: 'Fika House',
    location: 'Seattle, WA',
    stage: 'CUSTOMER',
    tags: ['Wholesale'],
    seenDaysAgo: 7,
  },
  {
    name: 'Zoe Patterson',
    email: 'zoe.patterson@gmail.com',
    location: 'Raleigh, NC',
    stage: 'CUSTOMER',
    tags: ['Subscriber'],
    seenDaysAgo: 1,
  },
  {
    name: 'Samuel Adeyemi',
    email: 'sam.adeyemi@yahoo.com',
    location: 'Houston, TX',
    stage: 'LEAD',
    tags: [],
    seenDaysAgo: 0,
  },
  {
    name: 'Ana Sousa',
    email: 'ana.sousa@gmail.com',
    location: 'Newark, NJ',
    stage: 'CUSTOMER',
    tags: ['Refund requested'],
    seenDaysAgo: 4,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Idempotent: contacts are matched by email, or by phone when there is no email. */
export async function seedDemoContacts(prisma: PrismaClient, organizationId: string) {
  const tagIds = new Map<string, string>();
  for (const tag of TAGS) {
    const { id } = await prisma.tag.upsert({
      where: { organizationId_name: { organizationId, name: tag.name } },
      update: {},
      create: { organizationId, ...tag },
    });
    tagIds.set(tag.name, id);
  }

  const members = await prisma.organizationMember.findMany({
    where: { organizationId },
    include: { user: { select: { email: true, name: true } } },
  });
  const memberByEmail = new Map(members.map((m) => [m.user.email, m]));

  let created = 0;
  for (const [index, c] of CONTACTS.entries()) {
    const existing = await prisma.contact.findFirst({
      where: { organizationId, ...(c.email ? { email: c.email } : { phone: c.phone }) },
      select: { id: true },
    });
    if (existing) continue;

    // Spread creation over the last few months, oldest first, so "newest" sorting looks lived in.
    const createdAt = new Date(Date.now() - (120 - index * 4) * DAY_MS);
    const lastSeenAt =
      c.seenDaysAgo === undefined
        ? null
        : new Date(Date.now() - c.seenDaysAgo * DAY_MS - index * 3_600_000);

    await prisma.contact.create({
      data: {
        organizationId,
        name: c.name,
        email: c.email,
        phone: c.phone,
        company: c.company,
        location: c.location,
        stage: c.stage,
        lastSeenAt,
        createdAt,
        tags: { create: c.tags.map((name) => ({ tagId: tagIds.get(name)! })) },
        identities: {
          create: [
            ...(c.email
              ? [{ organizationId, channel: 'EMAIL' as const, externalId: c.email }]
              : []),
            ...(c.phone
              ? [
                  {
                    organizationId,
                    channel: 'PHONE' as const,
                    externalId: c.phone.replace(/[^\d+]/g, ''),
                  },
                ]
              : []),
          ],
        },
        activities: {
          create: {
            organizationId,
            type: 'contact.created',
            metadata: { source: 'import' },
            createdAt,
          },
        },
        notes: {
          create: (c.notes ?? []).map((note) => {
            const author = memberByEmail.get(note.by);
            return { organizationId, body: note.body, authorId: author?.id };
          }),
        },
      },
    });
    created++;
  }
  return { contacts: created, tags: TAGS.length };
}

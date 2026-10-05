import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { ConversationPriority, ConversationStatus } from '../../src/generated/prisma/enums.js';

type Line =
  | { from: 'customer'; text: string; at: number }
  | { from: string; text: string; at: number; note?: boolean };

interface SeedConversation {
  contact: string;
  channel: 'chat' | 'email';
  subject?: string;
  status: ConversationStatus;
  priority?: ConversationPriority;
  assignee?: string;
  team?: string;
  tags?: string[];
  /** Minutes ago for each line; larger is older. */
  lines: Line[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const CONVERSATIONS: SeedConversation[] = [
  {
    contact: 'sarah.mitchell@gmail.com',
    channel: 'chat',
    status: 'OPEN',
    tags: ['Shipping'],
    lines: [
      {
        from: 'customer',
        text: 'Hi, I ordered the black hoodie last Thursday. Do you know when it will arrive?',
        at: 12 * MIN,
      },
    ],
  },
  {
    contact: 'ana.sousa@gmail.com',
    channel: 'chat',
    status: 'OPEN',
    priority: 'HIGH',
    tags: ['Refund requested'],
    lines: [
      {
        from: 'customer',
        text: "It's been 5 days since I asked for a refund on my last order and I haven't heard anything back.",
        at: 38 * MIN,
      },
      {
        from: 'customer',
        text: 'The beans were fine, I just ordered the wrong roast by mistake.',
        at: 37 * MIN,
      },
    ],
  },
  {
    contact: 'marcus@thedailygrindcafe.com',
    channel: 'email',
    subject: 'Decaf for the standing order',
    status: 'OPEN',
    assignee: 'sam@northstarcoffee.co',
    team: 'Wholesale',
    tags: ['Wholesale'],
    lines: [
      {
        from: 'customer',
        text: "Hey Sam, a few regulars keep asking for decaf after 3pm. Can we add one to the standing order? Needs to hold up as espresso, our grinder's dialed for the house blend.",
        at: 26 * HOUR,
      },
      {
        from: 'sam@northstarcoffee.co',
        text: "Hi Marcus, the Decaf Sumatra (Swiss Water) pulls well as espresso: heavier body, low acidity, so you may only need to go a notch finer. I can add 4 bags to Thursday's delivery. Want me to?",
        at: 25 * HOUR,
      },
      {
        from: 'customer',
        text: 'Yes please, 4 bags. And can the invoice go to accounts@thedailygrindcafe.com from now on?',
        at: 3 * HOUR,
      },
      {
        from: 'sam@northstarcoffee.co',
        text: 'Billing email needs updating in Shopify too, not just our sheet. Daniel, can you do that one?',
        at: 2 * HOUR,
        note: true,
      },
    ],
  },
  {
    contact: 'gracekim.ny@gmail.com',
    channel: 'chat',
    status: 'OPEN',
    assignee: 'lucia@northstarcoffee.co',
    team: 'Customer Care',
    tags: ['Subscriber'],
    lines: [
      {
        from: 'customer',
        text: 'Can I switch my subscription to fine grind? I just got an espresso machine',
        at: 55 * MIN,
      },
      { from: 'customer', text: 'starting with the next box if possible', at: 54 * MIN },
    ],
  },
  {
    contact: 'sam.adeyemi@yahoo.com',
    channel: 'chat',
    status: 'OPEN',
    assignee: 'tom@northstarcoffee.co',
    team: 'Customer Care',
    lines: [
      {
        from: 'customer',
        text: "Which of your coffees is least acidic? Sharp coffee upsets my stomach but I don't want decaf.",
        at: 4 * HOUR,
      },
      {
        from: 'tom@northstarcoffee.co',
        text: 'Colombia Huila or the Northstar Blend. Both are chocolatey and low acid. The Ethiopia is the one to avoid.',
        at: 3 * HOUR + 50 * MIN,
        note: true,
      },
    ],
  },
  {
    contact: 'ben.fischer@gmx.de',
    channel: 'chat',
    status: 'OPEN',
    lines: [
      {
        from: 'customer',
        text: 'Hello, do you ship to Germany? And roughly what does it cost?',
        at: 2 * HOUR,
      },
    ],
  },
  {
    contact: 'kpatel.home@yahoo.com',
    channel: 'chat',
    status: 'OPEN',
    tags: ['Shipping'],
    lines: [
      {
        from: 'customer',
        text: 'is the cold brew pack coming back? been out for weeks',
        at: 5 * HOUR,
      },
    ],
  },
  {
    contact: 'pnguyen@brightlinehq.com',
    channel: 'email',
    subject: 'Coffee for our Denver office',
    status: 'PENDING',
    assignee: 'sam@northstarcoffee.co',
    team: 'Wholesale',
    tags: ['Wholesale'],
    lines: [
      {
        from: 'customer',
        text: "We're about 120 people and moving off pods. Do you supply offices, and do you lend or lease batch brewers?",
        at: 4 * DAY,
      },
      {
        from: 'sam@northstarcoffee.co',
        text: "Hi Priscilla, we do. I've attached our office price sheet. For your size most teams start with two batch brewers on a free loan, as long as you take at least 20 lb a month. Happy to set up a tasting at your office next week.",
        at: 4 * DAY - 2 * HOUR,
      },
    ],
  },
  {
    contact: 'chloe@northfieldyoga.com',
    channel: 'email',
    subject: 'Selling your bags at our studio',
    status: 'OPEN',
    assignee: 'sam@northstarcoffee.co',
    team: 'Wholesale',
    lines: [
      {
        from: 'customer',
        text: 'Hi! We run a yoga studio in Madison with a small retail shelf. Would you do a wholesale price on 12 oz bags, maybe 10 to 15 a month?',
        at: 2 * DAY,
      },
    ],
  },
  {
    contact: 'danreyes88@gmail.com',
    channel: 'chat',
    status: 'RESOLVED',
    assignee: 'tom@northstarcoffee.co',
    team: 'Customer Care',
    tags: ['Refund requested'],
    lines: [
      {
        from: 'customer',
        text: 'My 2 lb bag arrived with the seam split open and beans all over the box. Not great.',
        at: 7 * DAY,
      },
      {
        from: 'tom@northstarcoffee.co',
        text: "Sorry Daniel, that's on us. I've sent a replacement today, no need to return the damaged one. You'll get tracking by email this afternoon.",
        at: 7 * DAY - 40 * MIN,
      },
      { from: 'customer', text: 'Thanks, appreciate the quick fix', at: 7 * DAY - 35 * MIN },
    ],
  },
  {
    contact: 'zoe.patterson@gmail.com',
    channel: 'email',
    subject: 'Pausing my subscription',
    status: 'RESOLVED',
    assignee: 'tom@northstarcoffee.co',
    team: 'Customer Care',
    tags: ['Subscriber'],
    lines: [
      {
        from: 'customer',
        text: "I'm travelling for two weeks from the 12th, can I skip one delivery?",
        at: 3 * DAY,
      },
      {
        from: 'tom@northstarcoffee.co',
        text: 'Done, Zoe. Your next box now ships on the 28th instead of the 14th. Enjoy the trip!',
        at: 3 * DAY - 25 * MIN,
      },
    ],
  },
  {
    contact: 'hannah@lindqvistdesign.se',
    channel: 'email',
    subject: 'Printed cards in gift boxes',
    status: 'RESOLVED',
    assignee: 'lucia@northstarcoffee.co',
    tags: ['Gift order'],
    lines: [
      {
        from: 'customer',
        text: 'The gift boxes were a hit with our clients. Next time could each one include a small printed card with our logo?',
        at: 9 * DAY,
      },
      {
        from: 'lucia@northstarcoffee.co',
        text: 'So glad they went down well! Yes, for orders of 10 boxes or more we can include a printed card. Send the logo as a PDF when you order and we will take care of it.',
        at: 9 * DAY - 3 * HOUR,
      },
    ],
  },
  {
    contact: 'leo@fikahouse.co',
    channel: 'email',
    subject: 'Order confirmation',
    status: 'CLOSED',
    assignee: 'sam@northstarcoffee.co',
    team: 'Wholesale',
    lines: [
      {
        from: 'customer',
        text: 'Confirming 6 x 5 lb house espresso for Monday. Thanks!',
        at: 26 * HOUR,
      },
      {
        from: 'sam@northstarcoffee.co',
        text: 'Confirmed, Leo. Roasting Saturday, out Monday morning.',
        at: 25 * HOUR,
      },
    ],
  },
];

/** Idempotent: does nothing if the workspace already has conversations. */
export async function seedDemoInbox(prisma: PrismaClient, organizationId: string) {
  if ((await prisma.conversation.count({ where: { organizationId } })) > 0) {
    return { conversations: 0 };
  }

  const chat = await prisma.channel.create({
    data: {
      organizationId,
      type: 'WEBSITE_CHAT',
      name: 'Website chat',
      settings: {
        greeting:
          'Hi! Questions about an order or our coffee? We usually reply within a few minutes.',
      },
    },
  });
  const email = await prisma.channel.create({
    data: {
      organizationId,
      type: 'EMAIL',
      name: 'Support email',
      settings: { address: 'help@northstarcoffee.co' },
    },
  });

  for (const tag of [
    { name: 'Shipping', color: 'blue' },
    { name: 'Wholesale', color: 'violet' },
  ]) {
    await prisma.tag.upsert({
      where: { organizationId_name: { organizationId, name: tag.name } },
      update: {},
      create: { organizationId, ...tag },
    });
  }
  const tags = new Map(
    (await prisma.tag.findMany({ where: { organizationId } })).map((t) => [t.name, t.id]),
  );
  const members = new Map(
    (
      await prisma.organizationMember.findMany({
        where: { organizationId },
        include: { user: { select: { email: true, name: true } } },
      })
    ).map((m) => [m.user.email, m]),
  );
  const teams = new Map(
    (await prisma.team.findMany({ where: { organizationId } })).map((t) => [t.name, t.id]),
  );
  const contacts = new Map(
    (
      await prisma.contact.findMany({
        where: { organizationId, email: { in: CONVERSATIONS.map((c) => c.contact) } },
        select: { id: true, email: true },
      })
    ).map((c) => [c.email, c.id]),
  );

  const now = Date.now();
  for (const c of CONVERSATIONS) {
    const contactId = contacts.get(c.contact);
    if (!contactId) continue;

    const times = c.lines.map((l) => new Date(now - l.at));
    const visible = c.lines
      .map((l, i) => ({ ...l, time: times[i]! }))
      .filter((l) => !('note' in l && l.note));
    const last = visible.at(-1)!;
    const lastInbound = [...visible].reverse().find((l) => l.from === 'customer');
    const firstReply = visible.find((l) => l.from !== 'customer');
    const assignee = c.assignee ? members.get(c.assignee) : undefined;

    const conversation = await prisma.conversation.create({
      data: {
        organizationId,
        channelId: c.channel === 'chat' ? chat.id : email.id,
        contactId,
        subject: c.subject,
        status: c.status,
        priority: c.priority ?? 'NORMAL',
        assigneeId: assignee?.id,
        teamId: c.team ? teams.get(c.team) : undefined,
        lastMessageAt: last.time,
        lastMessagePreview: last.text.slice(0, 140),
        lastInboundAt: lastInbound?.time,
        firstResponseAt: firstReply?.time,
        resolvedAt:
          c.status === 'RESOLVED' || c.status === 'CLOSED'
            ? new Date(last.time.getTime() + 10 * MIN)
            : null,
        createdAt: times[0],
        tags: {
          create: (c.tags ?? []).flatMap((name) =>
            tags.get(name) ? [{ tagId: tags.get(name)! }] : [],
          ),
        },
      },
    });

    await prisma.message.createMany({
      data: c.lines.map((line, i) => {
        const author = line.from === 'customer' ? undefined : members.get(line.from);
        return {
          organizationId,
          conversationId: conversation.id,
          sender: line.from === 'customer' ? ('CONTACT' as const) : ('MEMBER' as const),
          authorId: author?.id,
          internal: 'note' in line && line.note === true,
          body: line.text,
          createdAt: times[i],
        };
      }),
    });

    await prisma.contactActivity.create({
      data: {
        organizationId,
        contactId,
        type: 'conversation.started',
        metadata: { conversationId: conversation.id, excerpt: c.lines[0]!.text.slice(0, 140) },
        createdAt: times[0],
      },
    });

    // The assignee has read up to their own last message; everyone else has not.
    if (assignee && firstReply) {
      await prisma.conversationRead.create({
        data: {
          conversationId: conversation.id,
          memberId: assignee.id,
          lastReadAt:
            lastInbound && lastInbound.time > firstReply.time ? firstReply.time : last.time,
        },
      });
    }
  }
  return { conversations: CONVERSATIONS.length };
}

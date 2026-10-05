import { EventEmitter2 } from '@nestjs/event-emitter';
import { InboxEvents, type MessageCreatedEvent } from '../src/modules/inbox/inbox.events.js';
import { MessagesService } from '../src/modules/inbox/messages.service.js';
import { createTestApp, rows, type TestApp } from './helpers/test-app.js';
import { type Person, workspaceHelpers } from './helpers/workspace.js';

interface Msg {
  sender: string;
  body: string;
  internal: boolean;
}

describe('inbox (e2e)', () => {
  let t: TestApp;
  let h: ReturnType<typeof workspaceHelpers>;
  let inbound: MessagesService;
  let owner: Person;
  let agent: Person;
  let sales: Person;
  let viewer: Person;
  let orgId: string;
  let agentMemberId: string;
  let channelId: string;

  beforeAll(async () => {
    t = await createTestApp();
    h = workspaceHelpers(t);
    inbound = t.app.get(MessagesService);
    await t.resetRateLimits();
    owner = await h.person('i-owner', 'Priya Raman');
    agent = await h.person('i-agent', 'Tom Becker');
    sales = await h.person('i-sales', 'Sam Whitfield');
    viewer = await h.person('i-viewer', 'Erin Walsh');
    orgId = await h.workspace(owner, 'E2E Inbox');
    agentMemberId = await h.join(owner, orgId, agent, 'agent');
    await h.join(owner, orgId, sales, 'sales');
    await h.join(owner, orgId, viewer, 'viewer');
    channelId = (
      await t.prisma.channel.create({
        data: { organizationId: orgId, type: 'WEBSITE_CHAT', name: 'Website chat' },
      })
    ).id;
  });

  beforeEach(async () => {
    await t.resetRateLimits();
  });

  afterAll(async () => {
    await t.prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    await t.prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
    await t.app.close();
  });

  async function customer(name: string) {
    const res = await h
      .as(owner, orgId)
      .post('/api/v1/contacts')
      .send({ name, email: `${name.toLowerCase().replace(/\s/g, '.')}.${Date.now()}@example.com` })
      .expect(201);
    return res.body.id as string;
  }

  const customerWrites = (contactId: string, body: string) =>
    inbound.receiveInbound({ organizationId: orgId, channelId, contactId, body });

  const thread = async (who: Person, id: string) =>
    rows<Msg>(await h.as(who, orgId).get(`/api/v1/conversations/${id}/messages`).expect(200));

  describe('inbound messages', () => {
    it('start a conversation, then continue it, and reopen it once resolved', async () => {
      const sarah = await customer('Sarah Mitchell');

      const first = await customerWrites(sarah, 'Hi, where is my order #10482?');
      const second = await customerWrites(sarah, 'It was the black hoodie.');
      expect(first.created).toBe(true);
      expect(second.conversationId).toBe(first.conversationId);

      await h
        .as(owner, orgId)
        .patch(`/api/v1/conversations/${first.conversationId}`)
        .send({ status: 'RESOLVED' })
        .expect(200);
      const third = await customerWrites(sarah, 'Actually, one more question');
      expect(third).toMatchObject({ conversationId: first.conversationId, reopened: true });

      const conversation = await h
        .as(owner, orgId)
        .get(`/api/v1/conversations/${first.conversationId}`)
        .expect(200);
      expect(conversation.body).toMatchObject({
        status: 'OPEN',
        lastMessagePreview: 'Actually, one more question',
        contact: { displayName: 'Sarah Mitchell' },
      });

      const timeline = await h.as(owner, orgId).get(`/api/v1/contacts/${sarah}/activity`);
      expect(rows<{ type: string }>(timeline).map((a) => a.type)).toContain('conversation.started');
    });
  });

  describe('replying', () => {
    it('picks up an unassigned conversation and notes it in the thread before the reply', async () => {
      const ben = await customer('Ben Fischer');
      const { conversationId } = await customerWrites(ben, 'Do you ship to Germany?');

      await h
        .as(agent, orgId)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .send({ body: 'We do, Ben. Shipping to Germany is $14 and takes about a week.' })
        .expect(201);

      const messages = await thread(agent, conversationId);
      expect(messages.map((m) => [m.sender, m.body])).toEqual([
        ['CONTACT', 'Do you ship to Germany?'],
        ['SYSTEM', 'Tom Becker took this conversation'],
        ['MEMBER', 'We do, Ben. Shipping to Germany is $14 and takes about a week.'],
      ]);
      const conversation = await h.as(agent, orgId).get(`/api/v1/conversations/${conversationId}`);
      expect(conversation.body).toMatchObject({
        assignee: { id: agentMemberId, name: 'Tom Becker' },
        handler: 'HUMAN_HANDLING',
      });
    });

    it('keeps internal notes out of the preview and away from the customer-facing event', async () => {
      const grace = await customer('Grace Kim');
      const { conversationId } = await customerWrites(grace, 'Can I switch to fine grind?');
      const seen: MessageCreatedEvent[] = [];
      const listener = (e: MessageCreatedEvent) => seen.push(e);
      t.app.get(EventEmitter2).on(InboxEvents.messageCreated, listener);

      const note = await h
        .as(agent, orgId)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .send({ body: 'Check her machine model before changing the grind.', internal: true })
        .expect(201);
      t.app.get(EventEmitter2).off(InboxEvents.messageCreated, listener);

      expect(note.body.internal).toBe(true);
      expect(seen).toEqual([
        expect.objectContaining({ messageId: note.body.id, internal: true, sender: 'MEMBER' }),
      ]);
      const conversation = await h.as(agent, orgId).get(`/api/v1/conversations/${conversationId}`);
      expect(conversation.body.lastMessagePreview).toBe('Can I switch to fine grind?');
      expect(conversation.body.assignee).toBeNull();
    });

    it('is not open to viewers', async () => {
      const zoe = await customer('Zoe Patterson');
      const { conversationId } = await customerWrites(zoe, 'Can I pause my subscription?');

      const res = await h
        .as(viewer, orgId)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .send({ body: 'Sure!' })
        .expect(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('unread', () => {
    it('counts customer messages since you last read, per person', async () => {
      const ana = await customer('Ana Sousa');
      const { conversationId } = await customerWrites(ana, 'Hello?');
      await customerWrites(ana, 'Anyone there? I need help with a refund.');

      const unread = async (who: Person) =>
        (await h.as(who, orgId).get(`/api/v1/conversations/${conversationId}`)).body
          .unreadCount as number;
      expect(await unread(agent)).toBe(2);
      expect(await unread(owner)).toBe(2);

      await h.as(agent, orgId).post(`/api/v1/conversations/${conversationId}/read`).expect(204);
      expect(await unread(agent)).toBe(0);
      expect(await unread(owner)).toBe(2);

      const onlyUnread = await h.as(agent, orgId).get('/api/v1/conversations?unread=true');
      expect(rows<{ id: string }>(onlyUnread).map((c) => c.id)).not.toContain(conversationId);
      await customerWrites(ana, 'Still waiting.');
      const again = await h.as(agent, orgId).get('/api/v1/conversations?unread=true');
      expect(rows<{ id: string }>(again).map((c) => c.id)).toContain(conversationId);
    });
  });

  describe('assignment and status', () => {
    it('assigns within the workspace only and records who did it', async () => {
      const marcus = await customer('Marcus Bell');
      const { conversationId } = await customerWrites(marcus, 'Can we add decaf to the order?');
      const outsider = await h.person('i-outsider');
      const otherOrg = await h.workspace(outsider, 'E2E Elsewhere');
      const outsiderMember = (await h.as(outsider, otherOrg).get('/api/v1/members').expect(200))
        .body[0].id as string;

      const bad = await h
        .as(owner, orgId)
        .post(`/api/v1/conversations/${conversationId}/assign`)
        .send({ assigneeId: outsiderMember })
        .expect(400);
      expect(bad.body.error.code).toBe('ASSIGNEE_NOT_AVAILABLE');

      await h
        .as(owner, orgId)
        .post(`/api/v1/conversations/${conversationId}/assign`)
        .send({ assigneeId: agentMemberId })
        .expect(200);
      const messages = await thread(owner, conversationId);
      expect(messages.at(-1)).toMatchObject({
        sender: 'SYSTEM',
        body: 'Priya Raman assigned this to Tom Becker',
      });

      const mine = await h.as(agent, orgId).get('/api/v1/conversations?view=mine');
      expect(rows<{ id: string }>(mine).map((c) => c.id)).toContain(conversationId);
      const counts = await h.as(agent, orgId).get('/api/v1/conversations/counts').expect(200);
      expect(counts.body.mine).toBeGreaterThanOrEqual(1);
    });

    it('keeps assignment to roles that may assign', async () => {
      const leo = await customer('Leo Andersson');
      const { conversationId } = await customerWrites(leo, 'Confirming Monday delivery');

      await h
        .as(sales, orgId)
        .post(`/api/v1/conversations/${conversationId}/assign`)
        .send({ assigneeId: null })
        .expect(403);
    });

    it('notes status changes in the thread and stamps resolution time', async () => {
      const dan = await customer('Daniel Reyes');
      const { conversationId } = await customerWrites(dan, 'Bag arrived split open');

      const res = await h
        .as(agent, orgId)
        .patch(`/api/v1/conversations/${conversationId}`)
        .send({ status: 'RESOLVED', priority: 'HIGH' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'RESOLVED', priority: 'HIGH' });

      const messages = await thread(agent, conversationId);
      expect(messages.at(-1)?.body).toBe('Tom Becker resolved');
      const resolved = await h.as(agent, orgId).get('/api/v1/conversations?status=RESOLVED');
      expect(rows<{ id: string }>(resolved).map((c) => c.id)).toContain(conversationId);
    });
  });

  describe('paging and isolation', () => {
    it('pages the inbox and a long thread without repeats', async () => {
      const busy = await customer('Busy Customer');
      let conversationId = '';
      for (let i = 1; i <= 7; i++) {
        ({ conversationId } = await customerWrites(busy, `Message ${i}`));
      }

      const first = await h
        .as(owner, orgId)
        .get(`/api/v1/conversations/${conversationId}/messages?limit=3`)
        .expect(200);
      const second = await h
        .as(owner, orgId)
        .get(
          `/api/v1/conversations/${conversationId}/messages?limit=3&before=${first.body.nextBefore}`,
        )
        .expect(200);
      expect(rows<Msg>(first).map((m) => m.body)).toEqual(['Message 5', 'Message 6', 'Message 7']);
      expect(rows<Msg>(second).map((m) => m.body)).toEqual(['Message 2', 'Message 3', 'Message 4']);

      const p1 = await h.as(owner, orgId).get('/api/v1/conversations?status=all&limit=2');
      const p2 = await h
        .as(owner, orgId)
        .get(`/api/v1/conversations?status=all&limit=2&cursor=${p1.body.nextCursor}`);
      const ids = [...rows<{ id: string }>(p1), ...rows<{ id: string }>(p2)].map((c) => c.id);
      expect(new Set(ids).size).toBe(4);
    });

    it("cannot read or change another workspace's conversation", async () => {
      const mia = await customer('Mia Rossi');
      const { conversationId } = await customerWrites(mia, 'Private question');
      const outsider = await h.person('i-intruder');
      const otherOrg = await h.workspace(outsider, 'E2E Intruder');

      await h.as(outsider, otherOrg).get(`/api/v1/conversations/${conversationId}`).expect(404);
      await h
        .as(outsider, otherOrg)
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .expect(404);
      await h
        .as(outsider, otherOrg)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .send({ body: 'hi' })
        .expect(404);
    });
  });
});

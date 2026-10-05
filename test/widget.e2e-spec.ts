import { io, type Socket } from 'socket.io-client';
import { createTestApp, rows, type TestApp } from './helpers/test-app.js';
import { type Person, workspaceHelpers } from './helpers/workspace.js';

interface ChannelBody {
  id: string;
  publicKey: string;
  webChat: { greeting: string; accentColor: string; allowedOrigins: string[] };
}
interface WidgetMsg {
  id: string;
  from: string;
  authorName: string | null;
  body: string;
}

describe('website chat (e2e)', () => {
  let t: TestApp;
  let h: ReturnType<typeof workspaceHelpers>;
  let url: string;
  let owner: Person;
  let agent: Person;
  let orgId: string;
  let channel: ChannelBody;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    h = workspaceHelpers(t);
    url = await t.app.getUrl();
    await t.resetRateLimits();
    owner = await h.person('w-owner', 'Priya Raman');
    agent = await h.person('w-agent', 'Tom Becker');
    orgId = await h.workspace(owner, 'E2E Widget');
    await h.join(owner, orgId, agent, 'agent');
    const res = await h
      .as(owner, orgId)
      .post('/api/v1/channels/website')
      .send({ name: 'Shop chat' })
      .expect(201);
    channel = res.body as ChannelBody;
  });

  beforeEach(async () => {
    await t.resetRateLimits();
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  afterAll(async () => {
    await t.prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    await t.prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
    await t.app.close();
  });

  const startSession = (body: Record<string, unknown>) =>
    h.http().post('/api/v1/widget/session').send(body);

  async function visitor(previousToken?: string) {
    const res = await startSession({ key: channel.publicKey, visitorToken: previousToken }).expect(
      200,
    );
    const token = res.body.visitorToken as string;
    const as = (req: ReturnType<ReturnType<typeof h.http>['get']>) =>
      req.set('Authorization', `Bearer ${token}`);
    return {
      token,
      session: res.body as { visitor: { name: string | null; email: string | null } },
      send: (body: Record<string, unknown>) =>
        as(h.http().post('/api/v1/widget/messages')).send(body),
      history: async () =>
        (await as(h.http().get('/api/v1/widget/messages')).expect(200)).body as WidgetMsg[],
    };
  }

  async function conversationOf(body: string) {
    const list = await h
      .as(owner, orgId)
      .get('/api/v1/conversations')
      .query({ search: body })
      .expect(200);
    return rows<{ id: string; contact: { id: string; displayName: string } }>(list)[0]!;
  }

  describe('channel settings', () => {
    it('are limited to roles with channel.manage', async () => {
      await h.as(agent, orgId).get('/api/v1/channels').expect(403);
      const list = await h.as(owner, orgId).get('/api/v1/channels').expect(200);
      expect((list.body as ChannelBody[]).map((c) => c.id)).toContain(channel.id);
      expect(channel.publicKey).toMatch(/^wk_/);
    });

    it('normalize allowed sites and refuse anything that is not a site', async () => {
      const res = await h
        .as(owner, orgId)
        .patch(`/api/v1/channels/${channel.id}`)
        .send({ allowedOrigins: ['https://Shop.Example.com/checkout'], accentColor: '#0F766E' })
        .expect(200);
      expect((res.body as ChannelBody).webChat).toMatchObject({
        allowedOrigins: ['https://shop.example.com'],
        accentColor: '#0f766e',
      });

      const bad = await h
        .as(owner, orgId)
        .patch(`/api/v1/channels/${channel.id}`)
        .send({ allowedOrigins: ['shop.example.com'] })
        .expect(400);
      expect(bad.body.error.code).toBe('INVALID_ORIGIN');

      const audit = await h
        .as(owner, orgId)
        .get('/api/v1/audit-logs')
        .query({ entityType: 'channel' })
        .expect(200);
      expect(rows<{ action: string }>(audit).map((e) => e.action)).toContain('channel.updated');

      await h
        .as(owner, orgId)
        .patch(`/api/v1/channels/${channel.id}`)
        .send({ allowedOrigins: [] })
        .expect(200);
    });
  });

  describe('session', () => {
    it('gives one answer for an unknown key and a channel that is turned off', async () => {
      const unknown = await startSession({ key: 'wk_doesnotexist000' }).expect(404);
      expect(unknown.body.error.code).toBe('WIDGET_UNAVAILABLE');

      await h
        .as(owner, orgId)
        .patch(`/api/v1/channels/${channel.id}`)
        .send({ status: 'DISCONNECTED' })
        .expect(200);
      const off = await startSession({ key: channel.publicKey }).expect(404);
      expect(off.body.error.code).toBe('WIDGET_UNAVAILABLE');
      await h
        .as(owner, orgId)
        .patch(`/api/v1/channels/${channel.id}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
    });

    it('only starts on allowed sites once the list is set', async () => {
      await h
        .as(owner, orgId)
        .patch(`/api/v1/channels/${channel.id}`)
        .send({ allowedOrigins: ['https://*.northstarcoffee.co'] })
        .expect(200);

      const elsewhere = await startSession({
        key: channel.publicKey,
        pageOrigin: 'https://copycat.io',
      }).expect(403);
      expect(elsewhere.body.error.code).toBe('WIDGET_ORIGIN_NOT_ALLOWED');
      await startSession({ key: channel.publicKey }).expect(403);
      await startSession({
        key: channel.publicKey,
        pageOrigin: 'https://shop.northstarcoffee.co',
      }).expect(200);

      await h
        .as(owner, orgId)
        .patch(`/api/v1/channels/${channel.id}`)
        .send({ allowedOrigins: [] })
        .expect(200);
    });

    it('returns the greeting and workspace name for the widget header', async () => {
      const res = await startSession({ key: channel.publicKey }).expect(200);
      expect(res.body.config).toMatchObject({
        workspaceName: 'E2E Widget',
        greeting: 'Hi! How can we help?',
      });
    });
  });

  describe('messages', () => {
    it('start a conversation in the inbox and carry on after a reload', async () => {
      const v = await visitor();
      const body = `Is the Ethiopia roast in stock? ${Date.now()}`;
      await v.send({ body, name: 'Lena Fischer' }).expect(201);

      const conversation = await conversationOf(body);
      expect(conversation.contact.displayName).toBe('Lena Fischer');

      const again = await visitor(v.token);
      expect(again.session.visitor.name).toBe('Lena Fischer');
      expect((await again.history()).map((m) => m.body)).toEqual([body]);
    });

    it('show team replies but never internal notes or system lines', async () => {
      const v = await visitor();
      const body = `Can I change my grind size? ${Date.now()}`;
      await v.send({ body }).expect(201);
      const { id } = await conversationOf(body);

      await h
        .as(agent, orgId)
        .post(`/api/v1/conversations/${id}/messages`)
        .send({ body: 'Check with the roaster first', internal: true })
        .expect(201);
      await h
        .as(agent, orgId)
        .post(`/api/v1/conversations/${id}/messages`)
        .send({ body: 'Yes, until it ships tomorrow.' })
        .expect(201);

      expect(await v.history()).toEqual([
        expect.objectContaining({ from: 'visitor', body, authorName: null }),
        expect.objectContaining({
          from: 'team',
          body: 'Yes, until it ships tomorrow.',
          authorName: 'Tom',
        }),
      ]);
    });

    it('link a new email, but not one that belongs to another customer', async () => {
      const existing = await h
        .as(owner, orgId)
        .post('/api/v1/contacts')
        .send({ name: 'Sarah Mitchell', email: `sarah.${Date.now()}@example.com` })
        .expect(201);
      const sarahEmail = existing.body.email as string;

      const impostor = await visitor();
      const body = `Where is my order? ${Date.now()}`;
      await impostor.send({ body, name: 'Sarah', email: sarahEmail }).expect(201);
      const conversation = await conversationOf(body);
      expect(conversation.contact.id).not.toBe(existing.body.id);

      const timeline = await h
        .as(owner, orgId)
        .get(`/api/v1/contacts/${conversation.contact.id}/activity`)
        .expect(200);
      expect(rows<{ type: string }>(timeline).map((a) => a.type)).toContain(
        'contact.email_unverified',
      );

      const fresh = await visitor();
      const email = `new.${Date.now()}@example.com`;
      await fresh.send({ body: `Hello ${Date.now()}`, email }).expect(201);
      expect((await visitor(fresh.token)).session.visitor.email).toBe(email);
    });

    it('need a visitor token, and visitor and member tokens do not cross over', async () => {
      const v = await visitor();
      await h.http().get('/api/v1/widget/messages').expect(401);
      await h
        .http()
        .get('/api/v1/widget/messages')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(401);
      await h
        .http()
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${v.token}`)
        .expect(401);
    });
  });

  describe('realtime', () => {
    function widgetSocket(token: string): Promise<Socket> {
      const socket = io(`${url}/widget`, {
        auth: { visitorToken: token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);
      return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
      });
    }

    const heard = (socket: Socket, windowMs = 500) =>
      new Promise<string[]>((resolve) => {
        const ids: string[] = [];
        socket.on('message.created', (e: { messageId: string }) => ids.push(e.messageId));
        setTimeout(() => resolve(ids), windowMs);
      });

    it('tells the visitor about replies in their chat only, and never about notes', async () => {
      const v = await visitor();
      const other = await visitor();
      const body = `Do you have decaf? ${Date.now()}`;
      await v.send({ body }).expect(201);
      await other.send({ body: `Unrelated ${Date.now()}` }).expect(201);
      const { id } = await conversationOf(body);

      const mine = await widgetSocket(v.token);
      const theirs = await widgetSocket(other.token);
      const mineHeard = heard(mine);
      const theirsHeard = heard(theirs);

      await h
        .as(owner, orgId)
        .post(`/api/v1/conversations/${id}/messages`)
        .send({ body: 'Note: we are out of decaf', internal: true })
        .expect(201);
      const reply = await h
        .as(owner, orgId)
        .post(`/api/v1/conversations/${id}/messages`)
        .send({ body: 'We do, the Colombia Swiss Water.' })
        .expect(201);

      expect(await mineHeard).toEqual([reply.body.id]);
      expect(await theirsHeard).toEqual([]);
    });

    it('refuses a member access token', async () => {
      await expect(widgetSocket(owner.token)).rejects.toThrow('UNAUTHENTICATED');
    });
  });
});

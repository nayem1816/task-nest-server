import { io, type Socket } from 'socket.io-client';
import { SessionService } from '../src/modules/auth/session.service.js';
import { MessagesService } from '../src/modules/inbox/messages.service.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';
import { type Person, workspaceHelpers } from './helpers/workspace.js';

describe('realtime (e2e)', () => {
  let t: TestApp;
  let h: ReturnType<typeof workspaceHelpers>;
  let url: string;
  let owner: Person;
  let agent: Person;
  let outsider: Person;
  let orgId: string;
  let otherOrgId: string;
  let agentMemberId: string;
  let channelId: string;
  const open: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    h = workspaceHelpers(t);
    url = await t.app.getUrl();
    await t.resetRateLimits();
    owner = await h.person('rt-owner', 'Priya Raman');
    agent = await h.person('rt-agent', 'Tom Becker');
    outsider = await h.person('rt-outsider', 'Erin Walsh');
    orgId = await h.workspace(owner, 'E2E Realtime');
    otherOrgId = await h.workspace(outsider, 'E2E Realtime Other');
    agentMemberId = await h.join(owner, orgId, agent, 'agent');
    channelId = (
      await t.prisma.channel.create({
        data: { organizationId: orgId, type: 'WEBSITE_CHAT', name: 'Website chat' },
      })
    ).id;
  });

  beforeEach(async () => {
    await t.resetRateLimits();
  });

  afterEach(() => {
    for (const socket of open.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await t.prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    await t.prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
    await t.app.close();
  });

  function socketFor(token: string, organizationId: string): Socket {
    const socket = io(url, {
      auth: { token, organizationId },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    open.push(socket);
    return socket;
  }

  function connect(who: Person, organizationId = orgId): Promise<Socket> {
    const socket = socketFor(who.token, organizationId);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  function rejection(token: string, organizationId: string): Promise<string> {
    const socket = socketFor(token, organizationId);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => reject(new Error('connected but should have been refused')));
      socket.once('connect_error', (err: Error & { data?: { code?: string } }) =>
        resolve(err.data?.code ?? err.message),
      );
    });
  }

  function next<T>(socket: Socket, event: string, timeoutMs = 3_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ${event} within ${timeoutMs}ms`)),
        timeoutMs,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  /** Resolves true if `event` arrives within the window, false otherwise. */
  function arrives(socket: Socket, event: string, windowMs = 400): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        socket.off(event, onEvent);
        resolve(false);
      }, windowMs);
      const onEvent = () => {
        clearTimeout(timer);
        resolve(true);
      };
      socket.once(event, onEvent);
    });
  }

  const disconnected = (socket: Socket) =>
    new Promise<string>((resolve) => socket.once('disconnect', resolve));

  async function customerWrites(body: string) {
    const contact = await h
      .as(owner, orgId)
      .post('/api/v1/contacts')
      .send({ name: 'Sarah Mitchell', email: `sarah.${Date.now()}@example.com` })
      .expect(201);
    return t.app.get(MessagesService).receiveInbound({
      organizationId: orgId,
      channelId,
      contactId: contact.body.id as string,
      body,
    });
  }

  const sessionIdOf = (token: string) =>
    (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { sid: string }).sid;

  describe('handshake', () => {
    it('refuses a missing or forged token', async () => {
      expect(await rejection('', orgId)).toBe('UNAUTHENTICATED');
      expect(await rejection(`${owner.token}x`, orgId)).toBe('UNAUTHENTICATED');
    });

    it('requires a workspace id', async () => {
      expect(await rejection(owner.token, 'not-a-uuid')).toBe('ORGANIZATION_REQUIRED');
    });

    it('gives the same answer for a workspace you are not in and one that does not exist', async () => {
      expect(await rejection(owner.token, otherOrgId)).toBe('ORGANIZATION_ACCESS_DENIED');
      expect(await rejection(owner.token, '018f0000-0000-7000-8000-000000000000')).toBe(
        'ORGANIZATION_ACCESS_DENIED',
      );
    });

    it('refuses a revoked session even while its token has not expired', async () => {
      const person = await h.person('rt-revoked');
      await t.app.get(SessionService).revoke(sessionIdOf(person.token), 'test');
      expect(await rejection(person.token, orgId)).toBe('SESSION_EXPIRED');
    });
  });

  describe('inbox events', () => {
    it('reach members of the workspace, carry ids only, and stay inside it', async () => {
      const mine = await connect(agent);
      const theirs = await connect(outsider, otherOrgId);
      const created = next<Record<string, unknown>>(mine, 'message.created');
      const updated = next<Record<string, unknown>>(mine, 'conversation.updated');
      const leaked = arrives(theirs, 'message.created');

      const { conversationId, messageId } = await customerWrites('Where is my order #10482?');

      expect(await created).toEqual({
        conversationId,
        messageId,
        internal: false,
        sender: 'CONTACT',
      });
      expect(await updated).toMatchObject({ conversationId });
      expect(await leaked).toBe(false);
    });

    it('are not sent to a role that cannot read conversations', async () => {
      const role = await t.prisma.role.create({
        data: {
          organizationId: orgId,
          key: 'catalog',
          name: 'Catalog',
          permissions: ['product.read'],
        },
      });
      const clerk = await h.person('rt-clerk', 'Dana Cole');
      const clerkMemberId = await h.join(owner, orgId, clerk, 'viewer');
      await t.prisma.organizationMember.update({
        where: { id: clerkMemberId },
        data: { roleId: role.id },
      });

      const socket = await connect(clerk);
      const heard = arrives(socket, 'message.created');
      await customerWrites('Do you ship to Canada?');
      expect(await heard).toBe(false);
    });
  });

  describe('typing', () => {
    it('is relayed to the other members, not echoed back', async () => {
      const typist = await connect(agent);
      const watcher = await connect(owner);
      const { conversationId } = await customerWrites('Hello?');

      const seen = next<Record<string, unknown>>(watcher, 'typing');
      const echoed = arrives(typist, 'typing');
      typist.emit('typing', { conversationId });

      expect(await seen).toEqual({ conversationId, memberId: agentMemberId, name: 'Tom Becker' });
      expect(await echoed).toBe(false);
    });

    it('is dropped for a conversation from another workspace', async () => {
      const typist = await connect(outsider, otherOrgId);
      const watcher = await connect(owner);
      const { conversationId } = await customerWrites('Anyone there?');

      const seen = arrives(watcher, 'typing');
      typist.emit('typing', { conversationId });
      expect(await seen).toBe(false);
    });
  });

  describe('losing access', () => {
    it('closes the connection when the session is revoked', async () => {
      const person = await h.person('rt-logout');
      await h.join(owner, orgId, person, 'agent');
      const socket = await connect(person);
      const closed = disconnected(socket);

      await t.app.get(SessionService).revoke(sessionIdOf(person.token), 'logout');
      expect(await closed).toBe('io server disconnect');
    });

    it('closes the connection when the member is removed, and refuses to reopen it', async () => {
      const person = await h.person('rt-removed');
      const memberId = await h.join(owner, orgId, person, 'agent');
      const socket = await connect(person);
      const closed = disconnected(socket);

      await h.as(owner, orgId).delete(`/api/v1/members/${memberId}`).expect(204);
      expect(await closed).toBe('io server disconnect');
      expect(await rejection(person.token, orgId)).toBe('ORGANIZATION_ACCESS_DENIED');
    });

    it('extends the connection with a fresh token from the same session only', async () => {
      const socket = await connect(agent);
      const renew = (token: string) =>
        socket.emitWithAck('auth.renew', { token }) as Promise<{ ok: boolean }>;

      expect(await renew(agent.token)).toEqual({ ok: true });
      expect(await renew(owner.token)).toEqual({ ok: false });
      expect(await renew('garbage')).toEqual({ ok: false });
    });
  });
});

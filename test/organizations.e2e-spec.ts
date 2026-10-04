import { createTestApp, type TestApp, uniqueEmail } from './helpers/test-app.js';
import { workspaceHelpers } from './helpers/workspace.js';

describe('organizations, members and access control (e2e)', () => {
  let t: TestApp;
  let h: ReturnType<typeof workspaceHelpers>;
  const http = () => h.http();
  const person = (...args: Parameters<typeof h.person>) => h.person(...args);
  const workspace = (...args: Parameters<typeof h.workspace>) => h.workspace(...args);
  const as = (...args: Parameters<typeof h.as>) => h.as(...args);
  const roleId = (...args: Parameters<typeof h.roleId>) => h.roleId(...args);
  const join = (...args: Parameters<typeof h.join>) => h.join(...args);

  beforeAll(async () => {
    t = await createTestApp();
    h = workspaceHelpers(t);
  });

  beforeEach(async () => {
    await t.resetRateLimits();
  });

  afterAll(async () => {
    await t.prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    await t.prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
    await t.app.close();
  });

  describe('creating a workspace', () => {
    it('makes the creator owner, adds the six system roles and logs it', async () => {
      const maya = await person('maya', 'Maya Chen');
      const orgId = await workspace(maya, 'E2E Northstar Coffee');

      const mine = await http()
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${maya.token}`)
        .expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0]).toMatchObject({
        id: orgId,
        slug: expect.stringMatching(/^e2e-northstar-coffee/),
        role: { key: 'owner' },
      });
      expect(mine.body[0].permissions).toContain('billing.manage');
      const members = await as(maya, orgId).get('/api/v1/members').expect(200);
      expect(mine.body[0].memberId).toBe(members.body[0].id);

      const roles = await as(maya, orgId).get('/api/v1/roles').expect(200);
      expect((roles.body as { key: string }[]).map((r) => r.key)).toEqual([
        'owner',
        'admin',
        'manager',
        'agent',
        'sales',
        'viewer',
      ]);

      const audit = await as(maya, orgId).get('/api/v1/audit-logs').expect(200);
      expect(audit.body.data[0]).toMatchObject({
        action: 'organization.created',
        actorLabel: 'Maya Chen',
      });
    });

    it('gives a second workspace with the same name its own slug', async () => {
      const a = await person('slug-a');
      const b = await person('slug-b');
      await workspace(a, 'E2E Same Name');
      await workspace(b, 'E2E Same Name');

      const slugs = await t.prisma.organization.findMany({
        where: { name: 'E2E Same Name' },
        select: { slug: true },
      });
      expect(new Set(slugs.map((s) => s.slug)).size).toBe(slugs.length);
    });
  });

  describe('tenant isolation', () => {
    it("refuses access to a workspace you don't belong to, and to ones that don't exist", async () => {
      const owner = await person('iso-owner');
      const outsider = await person('iso-outsider');
      const orgId = await workspace(owner);

      const foreign = await as(outsider, orgId).get('/api/v1/members').expect(403);
      const missing = await as(outsider, '01a10000-0000-7000-8000-000000000000')
        .get('/api/v1/members')
        .expect(403);

      expect(foreign.body.error.code).toBe('ORGANIZATION_ACCESS_DENIED');
      expect(missing.body.error).toEqual({ ...foreign.body.error, requestId: expect.any(String) });
    });

    it('requires the organization header on workspace routes', async () => {
      const owner = await person('hdr');
      await workspace(owner);

      const none = await http()
        .get('/api/v1/members')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(400);
      expect(none.body.error.code).toBe('ORGANIZATION_REQUIRED');

      await http()
        .get('/api/v1/members')
        .set('Authorization', `Bearer ${owner.token}`)
        .set('x-organization-id', "' OR 1=1 --")
        .expect(400);
    });

    it("cannot reach another workspace's data by id, even with a valid membership elsewhere", async () => {
      const ownerA = await person('xa');
      const ownerB = await person('xb');
      const orgA = await workspace(ownerA, 'E2E Org A');
      const orgB = await workspace(ownerB, 'E2E Org B');
      const team = await as(ownerA, orgA)
        .post('/api/v1/teams')
        .send({ name: 'Billing' })
        .expect(201);

      // Owner of B, acting in B, aims at a team id from A.
      const res = await as(ownerB, orgB)
        .patch(`/api/v1/teams/${team.body.id}`)
        .send({ name: 'Hijacked' })
        .expect(404);
      expect(res.body.error.code).toBe('TEAM_NOT_FOUND');
    });

    it('locks out a disabled member', async () => {
      const owner = await person('dis-owner');
      const agent = await person('dis-agent');
      const orgId = await workspace(owner);
      const memberId = await join(owner, orgId, agent, 'agent');

      await as(owner, orgId)
        .patch(`/api/v1/members/${memberId}`)
        .send({ status: 'DISABLED' })
        .expect(200);

      const res = await as(agent, orgId).get('/api/v1/members').expect(403);
      expect(res.body.error.code).toBe('ORGANIZATION_ACCESS_DENIED');
      const mine = await http()
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${agent.token}`);
      expect(mine.body).toEqual([]);
    });
  });

  describe('permissions', () => {
    it('lets an agent see the team but not change it', async () => {
      const owner = await person('perm-owner');
      const agent = await person('perm-agent');
      const orgId = await workspace(owner);
      const agentId = await join(owner, orgId, agent, 'agent');

      await as(agent, orgId).get('/api/v1/members').expect(200);
      const res = await as(agent, orgId)
        .patch(`/api/v1/members/${agentId}`)
        .send({ status: 'DISABLED' })
        .expect(403);

      expect(res.body.error).toMatchObject({
        code: 'PERMISSION_DENIED',
        details: { missing: ['team.manage'] },
      });
      await as(agent, orgId).get('/api/v1/audit-logs').expect(403);
    });

    it('keeps the owner role in the hands of owners', async () => {
      const owner = await person('own-owner');
      const admin = await person('own-admin');
      const agent = await person('own-agent');
      const orgId = await workspace(owner);
      await join(owner, orgId, admin, 'admin');
      const agentId = await join(owner, orgId, agent, 'agent');
      const ownerRole = await roleId(owner, orgId, 'owner');

      const promote = await as(admin, orgId)
        .patch(`/api/v1/members/${agentId}`)
        .send({ roleId: ownerRole })
        .expect(403);
      expect(promote.body.error.code).toBe('OWNER_ONLY');

      const invite = await as(admin, orgId)
        .post('/api/v1/invitations')
        .send({ email: uniqueEmail('co-owner'), roleId: ownerRole })
        .expect(403);
      expect(invite.body.error.code).toBe('OWNER_ONLY');

      const members = await as(owner, orgId).get('/api/v1/members');
      const ownerMember = (members.body as { id: string; role: { key: string } }[]).find(
        (m) => m.role.key === 'owner',
      )!;
      await as(admin, orgId).delete(`/api/v1/members/${ownerMember.id}`).expect(403);
    });

    it('does not let anyone change their own role', async () => {
      const owner = await person('self');
      const orgId = await workspace(owner);
      const members = await as(owner, orgId).get('/api/v1/members');

      const res = await as(owner, orgId)
        .patch(`/api/v1/members/${members.body[0].id}`)
        .send({ roleId: await roleId(owner, orgId, 'viewer') })
        .expect(400);
      expect(res.body.error.code).toBe('CANNOT_CHANGE_SELF');
    });

    it('records role changes in the audit log', async () => {
      const owner = await person('audit-owner', 'Priya Raman');
      const agent = await person('audit-agent');
      const orgId = await workspace(owner);
      const agentId = await join(owner, orgId, agent, 'agent');

      await as(owner, orgId)
        .patch(`/api/v1/members/${agentId}`)
        .send({ roleId: await roleId(owner, orgId, 'manager') })
        .expect(200);

      const audit = await as(owner, orgId)
        .get('/api/v1/audit-logs?action=member.role_changed')
        .expect(200);
      expect(audit.body.data).toHaveLength(1);
      expect(audit.body.data[0]).toMatchObject({
        actorLabel: 'Priya Raman',
        entityId: agentId,
        metadata: { member: agent.email, from: 'agent', to: 'manager' },
      });
    });
  });

  describe('invitations', () => {
    it('shows a public preview and only accepts for the invited address', async () => {
      const owner = await person('inv-owner', 'Daniel Okafor');
      const invitee = await person('inv-guest');
      const stranger = await person('inv-stranger');
      const orgId = await workspace(owner, 'E2E Invite Co');
      await as(owner, orgId)
        .post('/api/v1/invitations')
        .send({ email: invitee.email.toUpperCase(), roleId: await roleId(owner, orgId, 'sales') })
        .expect(201);
      const token = t.outbox.lastToken(invitee.email.toUpperCase(), 'invitation');

      const preview = await http().get(`/api/v1/invitations/preview?token=${token}`).expect(200);
      expect(preview.body).toMatchObject({
        organizationName: 'E2E Invite Co',
        invitedBy: 'Daniel Okafor',
        roleName: 'Sales',
      });

      const wrong = await http()
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${stranger.token}`)
        .send({ token })
        .expect(403);
      expect(wrong.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');

      const ok = await http()
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${invitee.token}`)
        .send({ token })
        .expect(200);
      expect(ok.body).toMatchObject({ id: orgId, role: { key: 'sales' } });

      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${invitee.token}`);
      expect(me.body.emailVerified).toBe(true);

      await http()
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${invitee.token}`)
        .send({ token })
        .expect(400);
    });

    it('replaces a pending invitation and refuses existing members', async () => {
      const owner = await person('re-owner');
      const orgId = await workspace(owner);
      const agentRole = await roleId(owner, orgId, 'agent');
      const email = uniqueEmail('twice');

      await as(owner, orgId).post('/api/v1/invitations').send({ email, roleId: agentRole });
      const first = t.outbox.lastToken(email, 'invitation');
      await as(owner, orgId).post('/api/v1/invitations').send({ email, roleId: agentRole });

      const pending = await as(owner, orgId).get('/api/v1/invitations').expect(200);
      expect((pending.body as { email: string }[]).filter((i) => i.email === email)).toHaveLength(
        1,
      );
      await http().get(`/api/v1/invitations/preview?token=${first}`).expect(400);

      const already = await as(owner, orgId)
        .post('/api/v1/invitations')
        .send({ email: owner.email, roleId: agentRole })
        .expect(409);
      expect(already.body.error.code).toBe('ALREADY_MEMBER');
    });

    it('stops working once revoked', async () => {
      const owner = await person('rev-owner');
      const invitee = await person('rev-guest');
      const orgId = await workspace(owner);
      const sent = await as(owner, orgId)
        .post('/api/v1/invitations')
        .send({ email: invitee.email, roleId: await roleId(owner, orgId, 'viewer') })
        .expect(201);
      const token = t.outbox.lastToken(invitee.email, 'invitation');

      await as(owner, orgId).delete(`/api/v1/invitations/${sent.body.id}`).expect(204);

      await http()
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${invitee.token}`)
        .send({ token })
        .expect(400);
    });
  });

  describe('teams', () => {
    it('only takes members from the same workspace', async () => {
      const ownerA = await person('team-a');
      const ownerB = await person('team-b');
      const agent = await person('team-agent');
      const orgA = await workspace(ownerA, 'E2E Team A');
      const orgB = await workspace(ownerB, 'E2E Team B');
      const agentId = await join(ownerA, orgA, agent, 'agent');
      const outsiderId = (await as(ownerB, orgB).get('/api/v1/members')).body[0].id as string;

      const team = await as(ownerA, orgA)
        .post('/api/v1/teams')
        .send({ name: 'Customer Care', description: 'Orders and returns' })
        .expect(201);
      await as(ownerA, orgA).post('/api/v1/teams').send({ name: 'Customer Care' }).expect(409);

      const bad = await as(ownerA, orgA)
        .put(`/api/v1/teams/${team.body.id}/members`)
        .send({ memberIds: [agentId, outsiderId] })
        .expect(400);
      expect(bad.body.error).toMatchObject({
        code: 'MEMBER_NOT_IN_ORGANIZATION',
        details: { memberIds: [outsiderId] },
      });

      const ok = await as(ownerA, orgA)
        .put(`/api/v1/teams/${team.body.id}/members`)
        .send({ memberIds: [agentId] })
        .expect(200);
      expect(ok.body.members).toEqual([{ id: agentId, name: 'Jordan Ellis' }]);
    });
  });

  describe('audit log', () => {
    it('pages newest first with a cursor', async () => {
      const owner = await person('page');
      const orgId = await workspace(owner);
      for (const name of ['One', 'Two', 'Three']) {
        await as(owner, orgId).post('/api/v1/teams').send({ name }).expect(201);
      }

      const first = await as(owner, orgId).get('/api/v1/audit-logs?limit=2').expect(200);
      const second = await as(owner, orgId)
        .get(`/api/v1/audit-logs?limit=2&cursor=${first.body.nextCursor}`)
        .expect(200);

      const actions = [...first.body.data, ...second.body.data].map(
        (e: { action: string; metadata: { name?: string } }) => e.metadata?.name ?? e.action,
      );
      expect(actions).toEqual(['Three', 'Two', 'One', 'organization.created']);
      expect(second.body.nextCursor).toBeNull();
    });
  });
});

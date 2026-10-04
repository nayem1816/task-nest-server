import { createTestApp, rows, type TestApp } from './helpers/test-app.js';
import { type Person, workspaceHelpers } from './helpers/workspace.js';

describe('contacts (e2e)', () => {
  let t: TestApp;
  let h: ReturnType<typeof workspaceHelpers>;
  let owner: Person;
  let agent: Person;
  let viewer: Person;
  let orgId: string;

  beforeAll(async () => {
    t = await createTestApp();
    h = workspaceHelpers(t);
    await t.resetRateLimits();
    owner = await h.person('c-owner', 'Maya Chen');
    agent = await h.person('c-agent', 'Tom Becker');
    viewer = await h.person('c-viewer', 'Erin Walsh');
    orgId = await h.workspace(owner, 'E2E Contacts');
    await h.join(owner, orgId, agent, 'agent');
    await h.join(owner, orgId, viewer, 'viewer');
  });

  beforeEach(async () => {
    await t.resetRateLimits();
  });

  afterAll(async () => {
    await t.prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    await t.prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
    await t.app.close();
  });

  const createContact = async (who: Person, body: Record<string, unknown>) =>
    (await h.as(who, orgId).post('/api/v1/contacts').send(body).expect(201)).body as {
      id: string;
      displayName: string;
    };

  const createTag = async (name: string, inOrg = orgId, who = owner) =>
    (await h.as(who, inOrg).post('/api/v1/tags').send({ name, color: 'teal' }).expect(201)).body
      .id as string;

  describe('creating', () => {
    it('needs at least a name, email or phone', async () => {
      const res = await h.as(agent, orgId).post('/api/v1/contacts').send({ company: 'Acme' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CONTACT_NEEDS_IDENTITY');
    });

    it('points at the existing contact when the email is taken, ignoring case', async () => {
      const first = await createContact(agent, {
        name: 'Sarah Mitchell',
        email: 'sarah.e2e@example.com',
      });

      const res = await h
        .as(agent, orgId)
        .post('/api/v1/contacts')
        .send({ name: 'Sarah M.', email: 'Sarah.E2E@Example.com' })
        .expect(409);

      expect(res.body.error).toMatchObject({
        code: 'CONTACT_EMAIL_TAKEN',
        details: { contactId: first.id },
      });
    });

    it('records an email identity and a created event', async () => {
      const contact = await createContact(agent, { email: 'only.email@example.com' });
      expect(contact.displayName).toBe('only.email@example.com');

      const detail = await h.as(agent, orgId).get(`/api/v1/contacts/${contact.id}`).expect(200);
      expect(detail.body.identities).toEqual([
        { channel: 'EMAIL', externalId: 'only.email@example.com' },
      ]);
      const activity = await h
        .as(agent, orgId)
        .get(`/api/v1/contacts/${contact.id}/activity`)
        .expect(200);
      expect(activity.body.data[0]).toMatchObject({
        type: 'contact.created',
        actorLabel: 'Tom Becker',
      });
    });

    it('is not allowed for viewers', async () => {
      const res = await h.as(viewer, orgId).post('/api/v1/contacts').send({ name: 'Nope' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('listing', () => {
    let vipTag: string;

    beforeAll(async () => {
      vipTag = await createTag('E2E VIP');
      await createContact(owner, {
        name: 'Marcus Bell',
        email: 'marcus@dailygrind.test',
        company: 'The Daily Grind',
        stage: 'CUSTOMER',
        tagIds: [vipTag],
      });
      await createContact(owner, {
        name: 'Priscilla Nguyen',
        company: 'Brightline',
        stage: 'LEAD',
      });
      await createContact(owner, { phone: '+1 773 555 0119' });
    });

    it('searches name, email, phone and company without caring about case', async () => {
      const search = async (q: string) =>
        rows<{ displayName: string }>(
          await h
            .as(viewer, orgId)
            .get(`/api/v1/contacts?search=${encodeURIComponent(q)}`)
            .expect(200),
        ).map((c) => c.displayName);

      expect(await search('marc')).toEqual(['Marcus Bell']);
      expect(await search('DAILYGRIND')).toEqual(['Marcus Bell']);
      expect(await search('brightline')).toEqual(['Priscilla Nguyen']);
      expect(await search('555 0119')).toEqual(['+1 773 555 0119']);
    });

    it('filters by stage and tag', async () => {
      const leads = await h.as(viewer, orgId).get('/api/v1/contacts?stage=LEAD').expect(200);
      expect(rows<{ name: string }>(leads).map((c) => c.name)).toEqual(['Priscilla Nguyen']);

      const vip = await h.as(viewer, orgId).get(`/api/v1/contacts?tagId=${vipTag}`).expect(200);
      expect(vip.body.data).toHaveLength(1);
      expect(vip.body.data[0].tags).toEqual([{ id: vipTag, name: 'E2E VIP', color: 'teal' }]);
    });

    it('pages newest first', async () => {
      const first = await h.as(viewer, orgId).get('/api/v1/contacts?limit=2').expect(200);
      const second = await h
        .as(viewer, orgId)
        .get(`/api/v1/contacts?limit=2&cursor=${first.body.nextCursor}`)
        .expect(200);

      const ids = [...first.body.data, ...second.body.data].map((c: { id: string }) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort().reverse()).toEqual(ids);
    });
  });

  describe('editing', () => {
    it('logs stage changes and field edits separately, and keeps identities in step', async () => {
      const contact = await createContact(agent, {
        name: 'Daniel Reyes',
        email: 'dan.old@example.com',
      });

      const res = await h
        .as(agent, orgId)
        .patch(`/api/v1/contacts/${contact.id}`)
        .send({ stage: 'CUSTOMER', email: 'dan.new@example.com', location: 'San Antonio, TX' })
        .expect(200);
      expect(res.body.identities).toEqual([
        { channel: 'EMAIL', externalId: 'dan.new@example.com' },
      ]);

      const activity = await h
        .as(agent, orgId)
        .get(`/api/v1/contacts/${contact.id}/activity`)
        .expect(200);
      const types = rows<{ type: string }>(activity).map((a) => a.type);
      expect(types).toEqual(['contact.updated', 'stage.changed', 'contact.created']);
      expect(activity.body.data[0].metadata).toEqual({ fields: ['email', 'location'] });
      expect(activity.body.data[1].metadata).toEqual({ from: 'VISITOR', to: 'CUSTOMER' });
    });

    it('clears a field when sent an empty string', async () => {
      const contact = await createContact(agent, { name: 'Clear Me', company: 'Old Co' });
      const res = await h
        .as(agent, orgId)
        .patch(`/api/v1/contacts/${contact.id}`)
        .send({ company: '' })
        .expect(200);
      expect(res.body.company).toBeNull();
    });

    it('refuses tags from another workspace and logs tag changes by name', async () => {
      const contact = await createContact(agent, { name: 'Tagged Person' });
      const ours = await createTag('E2E Subscriber');
      const otherOwner = await h.person('c-other');
      const otherOrg = await h.workspace(otherOwner, 'E2E Other');
      const theirs = await createTag('Theirs', otherOrg, otherOwner);

      const bad = await h
        .as(agent, orgId)
        .put(`/api/v1/contacts/${contact.id}/tags`)
        .send({ tagIds: [ours, theirs] })
        .expect(400);
      expect(bad.body.error.code).toBe('TAG_NOT_FOUND');

      await h
        .as(agent, orgId)
        .put(`/api/v1/contacts/${contact.id}/tags`)
        .send({ tagIds: [ours] })
        .expect(200);
      const activity = await h.as(agent, orgId).get(`/api/v1/contacts/${contact.id}/activity`);
      expect(activity.body.data[0]).toMatchObject({
        type: 'tags.changed',
        metadata: { added: ['E2E Subscriber'], removed: [] },
      });
    });
  });

  describe('notes', () => {
    it("lets authors delete their notes but not other people's", async () => {
      const contact = await createContact(owner, { name: 'Noted Person' });
      const ownerNote = await h
        .as(owner, orgId)
        .post(`/api/v1/contacts/${contact.id}/notes`)
        .send({ body: 'Prefers whole bean.' })
        .expect(201);
      const agentNote = await h
        .as(agent, orgId)
        .post(`/api/v1/contacts/${contact.id}/notes`)
        .send({ body: 'Asked about decaf.' })
        .expect(201);
      expect(agentNote.body.author.name).toBe('Tom Becker');

      const denied = await h
        .as(agent, orgId)
        .delete(`/api/v1/contacts/${contact.id}/notes/${ownerNote.body.id}`)
        .expect(403);
      expect(denied.body.error.code).toBe('NOTE_NOT_YOURS');
      await h
        .as(agent, orgId)
        .delete(`/api/v1/contacts/${contact.id}/notes/${agentNote.body.id}`)
        .expect(204);
      // Owners can delete contacts, so they can delete anyone's note.
      await h
        .as(owner, orgId)
        .delete(`/api/v1/contacts/${contact.id}/notes/${ownerNote.body.id}`)
        .expect(204);

      const notes = await h.as(viewer, orgId).get(`/api/v1/contacts/${contact.id}/notes`);
      expect(notes.body.data).toEqual([]);
    });
  });

  describe('isolation and deletion', () => {
    it("cannot read or change another workspace's contact", async () => {
      const contact = await createContact(owner, { name: 'Private Customer' });
      const outsider = await h.person('c-outsider');
      const otherOrg = await h.workspace(outsider, 'E2E Outsider');

      await h.as(outsider, otherOrg).get(`/api/v1/contacts/${contact.id}`).expect(404);
      await h
        .as(outsider, otherOrg)
        .patch(`/api/v1/contacts/${contact.id}`)
        .send({ name: 'x' })
        .expect(404);
      await h.as(outsider, otherOrg).delete(`/api/v1/contacts/${contact.id}`).expect(404);
    });

    it('only lets roles with contact.delete remove contacts, and audits it', async () => {
      const contact = await createContact(agent, {
        name: 'Leaving Soon',
        email: 'bye@example.com',
      });

      await h.as(agent, orgId).delete(`/api/v1/contacts/${contact.id}`).expect(403);
      await h.as(owner, orgId).delete(`/api/v1/contacts/${contact.id}`).expect(204);
      await h.as(owner, orgId).get(`/api/v1/contacts/${contact.id}`).expect(404);

      const audit = await h
        .as(owner, orgId)
        .get('/api/v1/audit-logs?action=contact.deleted')
        .expect(200);
      expect(audit.body.data[0]).toMatchObject({
        entityId: contact.id,
        metadata: { name: 'Leaving Soon', email: 'bye@example.com' },
      });
    });
  });
});

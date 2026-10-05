import { KnowledgeIndexer } from '../src/modules/knowledge/knowledge-indexer.service.js';
import { createTestApp, rows, type TestApp } from './helpers/test-app.js';
import { type Person, workspaceHelpers } from './helpers/workspace.js';

interface Source {
  id: string;
  status: string;
  error: string | null;
  chunkCount: number;
  title: string;
}
interface Hit {
  sourceTitle: string;
  heading: string | null;
  content: string;
  similarity: number;
}

const SHIPPING = [
  '# Shipping',
  'Orders leave our Austin roastery within 2 business days.',
  '## International',
  'We ship to Canada and the United Kingdom. Customs fees are paid by the customer.',
].join('\n');

const RETURNS = [
  '# Returns',
  'Unopened bags can be returned within 30 days for a full refund.',
  'Opened coffee cannot be returned, but tell us if it tasted wrong.',
].join('\n');

describe('knowledge (e2e)', () => {
  let t: TestApp;
  let h: ReturnType<typeof workspaceHelpers>;
  let indexer: KnowledgeIndexer;
  let owner: Person;
  let viewer: Person;
  let orgId: string;

  beforeAll(async () => {
    t = await createTestApp();
    h = workspaceHelpers(t);
    indexer = t.app.get(KnowledgeIndexer);
    await t.resetRateLimits();
    owner = await h.person('k-owner', 'Priya Raman');
    viewer = await h.person('k-viewer', 'Erin Walsh');
    orgId = await h.workspace(owner, 'E2E Knowledge');
    await h.join(owner, orgId, viewer, 'viewer');
  });

  beforeEach(async () => {
    await t.resetRateLimits();
    t.ai.configured = true;
  });

  afterAll(async () => {
    await t.prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    await t.prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
    await t.app.close();
  });

  const as = (who: Person = owner, org = orgId) => h.as(who, org);

  /** Runs the indexing job the worker would run, for the source's current revision. */
  async function indexNow(id: string): Promise<Source> {
    const { revision } = await t.prisma.knowledgeSource.findUniqueOrThrow({ where: { id } });
    await indexer.index(id, revision);
    return (await as().get(`/api/v1/knowledge/sources/${id}`).expect(200)).body as Source;
  }

  async function addText(title: string, content: string): Promise<Source> {
    const res = await as()
      .post('/api/v1/knowledge/sources/text')
      .send({ title, content })
      .expect(201);
    return res.body as Source;
  }

  const search = async (query: string, who = owner, org = orgId) =>
    (await as(who, org).post('/api/v1/knowledge/search').send({ query }).expect(200)).body as Hit[];

  it('lets readers see and search, but only managers change sources', async () => {
    await as(viewer)
      .post('/api/v1/knowledge/sources/text')
      .send({ title: 'x', content: 'y' })
      .expect(403);
    await as(viewer).get('/api/v1/knowledge/sources').expect(200);
  });

  it('indexes a written article into passages under their headings', async () => {
    const added = await addText('Shipping policy', SHIPPING);
    expect(added.status).toBe('PENDING');

    const ready = await indexNow(added.id);
    expect(ready).toMatchObject({ status: 'READY', error: null, chunkCount: 2 });
    const detail = (await as().get(`/api/v1/knowledge/sources/${added.id}`).expect(200)).body as {
      chunks: { heading: string }[];
    };
    expect(detail.chunks.map((c) => c.heading)).toEqual(['Shipping', 'Shipping > International']);

    const usage = await t.prisma.aiUsage.findFirst({
      where: { organizationId: orgId, feature: 'knowledge.embed' },
    });
    expect(usage).toMatchObject({ ok: true });
  });

  it('finds the passage that answers the question, from the right source', async () => {
    await indexNow((await addText('Returns policy', RETURNS)).id);

    const canada = await search('Do you ship to Canada?');
    expect(canada[0]).toMatchObject({
      sourceTitle: 'Shipping policy',
      heading: 'Shipping > International',
    });

    const refund = await search('can I get a refund on unopened bags');
    expect(refund[0]).toMatchObject({ sourceTitle: 'Returns policy' });
    // A zero vector anywhere makes similarity NaN, which JSON turns into null.
    for (const hit of [...canada, ...refund]) expect(Number.isFinite(hit.similarity)).toBe(true);
    expect(canada[0]!.similarity).toBeGreaterThan(canada.at(-1)!.similarity);
  });

  it('re-indexes an edited article and ignores the job for the old text', async () => {
    const source = await addText('Hours', 'We answer email Monday to Friday.');
    const { revision: first } = await t.prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: source.id },
    });

    await as()
      .patch(`/api/v1/knowledge/sources/${source.id}`)
      .send({ content: 'We answer email every day, including weekends.' })
      .expect(200);

    await indexer.index(source.id, first); // stale job: must not write
    expect(
      (await t.prisma.knowledgeSource.findUniqueOrThrow({ where: { id: source.id } })).status,
    ).toBe('PENDING');

    await indexNow(source.id);
    const hits = await search('weekends');
    expect(hits[0]!.content).toContain('including weekends');
    expect(hits.some((hit) => hit.content.includes('Monday to Friday'))).toBe(false);
  });

  it('says plainly why indexing failed when AI is not set up', async () => {
    const source = await addText('Wholesale', 'Wholesale starts at 10 bags.');
    t.ai.configured = false;
    const failed = await indexNow(source.id);
    expect(failed).toMatchObject({
      status: 'FAILED',
      error: 'AI is not set up on this server, so sources cannot be indexed yet.',
    });
    t.ai.configured = true;
    await as().post(`/api/v1/knowledge/sources/${source.id}/reindex`).expect(200);
    expect(await indexNow(source.id)).toMatchObject({ status: 'READY', error: null });
  });

  it('reads uploaded files and refuses types it cannot read', async () => {
    const res = await as()
      .post('/api/v1/knowledge/sources/file')
      .attach(
        'file',
        Buffer.from('# Brewing\n\nUse 60 grams of coffee per litre of water.'),
        'brewing-guide.md',
      )
      .expect(201);
    const source = res.body as Source;
    expect(source.title).toBe('brewing-guide');
    expect([...t.storage.objects.keys()].some((k) => k.includes(source.id))).toBe(true);

    expect(await indexNow(source.id)).toMatchObject({ status: 'READY', chunkCount: 1 });
    expect((await search('how many grams per litre'))[0]!.sourceTitle).toBe('brewing-guide');

    const bad = await as()
      .post('/api/v1/knowledge/sources/file')
      .attach('file', Buffer.from('GIF89a'), 'logo.gif')
      .expect(400);
    expect(bad.body.error.code).toBe('KNOWLEDGE_FILE_TYPE');
  });

  it('never fetches private addresses, and does not add the same page twice', async () => {
    const res = await as()
      .post('/api/v1/knowledge/sources/url')
      .send({ url: 'http://169.254.169.254/latest/meta-data/' })
      .expect(201);
    const failed = await indexNow((res.body as Source).id);
    expect(failed).toMatchObject({
      status: 'FAILED',
      error: '169.254.169.254 is not a public website.',
    });

    const dup = await as()
      .post('/api/v1/knowledge/sources/url')
      .send({ url: 'http://169.254.169.254/latest/meta-data/' })
      .expect(409);
    expect(dup.body.error.code).toBe('KNOWLEDGE_URL_EXISTS');
  });

  it('keeps every workspace to its own knowledge', async () => {
    const other = await h.workspace(owner, 'E2E Knowledge Other');
    expect(await search('Do you ship to Canada?', owner, other)).toEqual([]);

    const [mine] = rows<Source>({
      body: { data: (await as().get('/api/v1/knowledge/sources')).body },
    });
    await as(owner, other).get(`/api/v1/knowledge/sources/${mine!.id}`).expect(404);
  });

  it('stops using a removed source at once and deletes its file', async () => {
    const res = await as()
      .post('/api/v1/knowledge/sources/file')
      .attach('file', Buffer.from('Gift cards never expire.'), 'gift-cards.txt')
      .expect(201);
    const id = (res.body as Source).id;
    await indexNow(id);
    expect((await search('do gift cards expire'))[0]!.sourceTitle).toBe('gift-cards');

    await as().delete(`/api/v1/knowledge/sources/${id}`).expect(204);
    expect(
      (await search('do gift cards expire')).some((hit) => hit.sourceTitle === 'gift-cards'),
    ).toBe(false);
    expect([...t.storage.objects.keys()].some((k) => k.includes(id))).toBe(false);
    expect(await t.prisma.knowledgeChunk.count({ where: { sourceId: id } })).toBe(0);

    const audit = await as()
      .get('/api/v1/audit-logs')
      .query({ entityType: 'knowledge_source' })
      .expect(200);
    expect(rows<{ action: string }>(audit).map((e) => e.action)).toContain(
      'knowledge.source_removed',
    );
  });
});

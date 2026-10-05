import { createTestApp, type TestApp } from './helpers/test-app.js';
import { type Person, workspaceHelpers } from './helpers/workspace.js';

describe('ai (e2e)', () => {
  let t: TestApp;
  let h: ReturnType<typeof workspaceHelpers>;
  let owner: Person;
  let viewer: Person;
  let orgId: string;

  beforeAll(async () => {
    t = await createTestApp();
    h = workspaceHelpers(t);
    await t.resetRateLimits();
    owner = await h.person('ai-owner', 'Priya Raman');
    viewer = await h.person('ai-viewer', 'Erin Walsh');
    orgId = await h.workspace(owner, 'E2E AI');
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

  it('reports whether AI is set up, to anyone who can see agents', async () => {
    const res = await h.as(viewer, orgId).get('/api/v1/ai/status').expect(200);
    expect(res.body).toEqual({
      configured: true,
      provider: 'scripted',
      chatModel: 'scripted-chat',
      embeddingModel: 'scripted-embed',
    });

    t.ai.configured = false;
    const off = await h.as(viewer, orgId).get('/api/v1/ai/status').expect(200);
    expect(off.body).toMatchObject({ configured: false, provider: null });
  });

  it('runs the connection check for managers only, and records the usage', async () => {
    await h.as(viewer, orgId).post('/api/v1/ai/check').expect(403);

    t.ai.script({ reply: 'ready', usage: [12, 1] });
    const res = await h.as(owner, orgId).post('/api/v1/ai/check').expect(200);
    expect(res.body).toMatchObject({ reply: 'ready', model: 'scripted-chat' });

    const rows = await t.prisma.aiUsage.findMany({ where: { organizationId: orgId } });
    expect(rows).toEqual([
      expect.objectContaining({ feature: 'ai.check', ok: true, inputTokens: 12, outputTokens: 1 }),
    ]);
  });

  it('retries a transient failure once, then gives a friendly error', async () => {
    t.ai.script({ fail: 'AI_RATE_LIMITED' }, { reply: 'ready' });
    await h.as(owner, orgId).post('/api/v1/ai/check').expect(200);

    t.ai.script({ fail: 'AI_UNAVAILABLE' }, { fail: 'AI_UNAVAILABLE' });
    const failed = await h.as(owner, orgId).post('/api/v1/ai/check').expect(502);
    expect(failed.body.error).toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: 'The AI provider is not responding. Try again in a moment.',
    });
    expect(JSON.stringify(failed.body)).not.toContain('scripted failure');

    t.ai.script({ fail: 'AI_BAD_REQUEST' }, { reply: 'never reached' });
    await h.as(owner, orgId).post('/api/v1/ai/check').expect(502);
    expect(t.ai.requests.at(-1)).toBeDefined();
  });

  it('says plainly when AI is not set up, without calling anything', async () => {
    t.ai.configured = false;
    const before = t.ai.requests.length;
    const res = await h.as(owner, orgId).post('/api/v1/ai/check').expect(503);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
    expect(t.ai.requests.length).toBe(before);
  });

  it('summarizes usage by feature and day, failures included', async () => {
    const res = await h.as(viewer, orgId).get('/api/v1/ai/usage').query({ days: 7 }).expect(200);
    const { byFeature } = res.body as { byFeature: { feature: string }[] };
    const check = byFeature.find((f) => f.feature === 'ai.check');
    // 1 + 1 (retried, succeeded) + 1 failed + 1 failed (not retried)
    expect(check).toMatchObject({ requests: 4, failed: 2 });
    expect(res.body.totals.requests).toBe(4);
    expect(res.body.byDay).toHaveLength(1);
    expect(res.body.byDay[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps usage per workspace', async () => {
    const other = await h.workspace(owner, 'E2E AI Other');
    const res = await h.as(owner, other).get('/api/v1/ai/usage').expect(200);
    expect(res.body.totals.requests).toBe(0);
  });
});

import { createTestApp, rows, type TestApp } from './helpers/test-app.js';
import { type Person, workspaceHelpers } from './helpers/workspace.js';

describe('products and orders (e2e)', () => {
  let t: TestApp;
  let h: ReturnType<typeof workspaceHelpers>;
  let owner: Person;
  let agent: Person;
  let orgId: string;
  let espresso: string;
  let filters: string;

  beforeAll(async () => {
    t = await createTestApp();
    h = workspaceHelpers(t);
    await t.resetRateLimits();
    owner = await h.person('o-owner', 'Maya Chen');
    agent = await h.person('o-agent', 'Tom Becker');
    orgId = await h.workspace(owner, 'E2E Commerce');
    await h.join(owner, orgId, agent, 'agent');
    espresso = await product('House Espresso, 12 oz', 'HSE-12', 1700);
    filters = await product('Paper Filters', 'GEAR-FILT', 700);
  });

  beforeEach(async () => {
    await t.resetRateLimits();
  });

  afterAll(async () => {
    await t.prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    await t.prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
    await t.app.close();
  });

  async function product(
    name: string,
    sku: string,
    priceCents: number,
    inOrg = orgId,
    who = owner,
  ) {
    const res = await h
      .as(who, inOrg)
      .post('/api/v1/products')
      .send({ name, sku, priceCents, category: 'Coffee' })
      .expect(201);
    return res.body.id as string;
  }

  async function contact(name: string, email: string) {
    const res = await h.as(owner, orgId).post('/api/v1/contacts').send({ name, email }).expect(201);
    return res.body.id as string;
  }

  describe('products', () => {
    it('keeps SKUs unique and catalogue edits to commerce managers', async () => {
      const dup = await h
        .as(owner, orgId)
        .post('/api/v1/products')
        .send({ name: 'Copy', sku: 'HSE-12', priceCents: 100 })
        .expect(409);
      expect(dup.body.error.code).toBe('SKU_TAKEN');

      await h
        .as(agent, orgId)
        .post('/api/v1/products')
        .send({ name: 'Nope', priceCents: 100 })
        .expect(403);
      const list = await h.as(agent, orgId).get('/api/v1/products?search=espresso').expect(200);
      expect(rows<{ sku: string }>(list).map((p) => p.sku)).toEqual(['HSE-12']);
    });
  });

  describe('orders', () => {
    it('prices lines from the catalogue and makes the buyer a customer', async () => {
      const sarah = await contact('Sarah Mitchell', 'sarah.orders@example.com');

      const res = await h
        .as(owner, orgId)
        .post('/api/v1/orders')
        .send({
          contactId: sarah,
          items: [
            { productId: espresso, quantity: 2 },
            { productId: filters, quantity: 1 },
          ],
          shippingCents: 650,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        status: 'PAID',
        subtotalCents: 2 * 1700 + 700,
        shippingCents: 650,
        totalCents: 2 * 1700 + 700 + 650,
        contact: { id: sarah, displayName: 'Sarah Mitchell' },
      });
      const items = res.body.items as { sku: string; totalCents: number }[];
      expect(items.map((i) => [i.sku, i.totalCents])).toEqual([
        ['HSE-12', 3400],
        ['GEAR-FILT', 700],
      ]);

      const buyer = await h.as(owner, orgId).get(`/api/v1/contacts/${sarah}`).expect(200);
      expect(buyer.body.stage).toBe('CUSTOMER');
      const activity = await h.as(owner, orgId).get(`/api/v1/contacts/${sarah}/activity`);
      expect(activity.body.data[0]).toMatchObject({
        type: 'order.placed',
        metadata: { number: res.body.number, totalCents: 4750 },
      });
    });

    it('numbers orders without gaps or duplicates, even when created at once', async () => {
      const created = await Promise.all(
        Array.from({ length: 5 }, () =>
          h
            .as(owner, orgId)
            .post('/api/v1/orders')
            .send({ items: [{ productId: filters, quantity: 1 }] }),
        ),
      );
      expect(created.every((r) => r.status === 201)).toBe(true);

      const numbers = created.map((r) => r.body.number as number).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(5);
      expect(numbers.at(-1)! - numbers[0]!).toBe(4);
      expect(numbers[0]).toBeGreaterThanOrEqual(10001);
    });

    it('refuses archived products and products from another workspace', async () => {
      const retired = await product('Retired Blend', 'OLD-1', 1500);
      await h
        .as(owner, orgId)
        .patch(`/api/v1/products/${retired}`)
        .send({ status: 'ARCHIVED' })
        .expect(200);
      const otherOwner = await h.person('o-other');
      const otherOrg = await h.workspace(otherOwner, 'E2E Other Shop');
      const foreign = await product('Their Coffee', 'THEIRS', 999, otherOrg, otherOwner);

      const res = await h
        .as(owner, orgId)
        .post('/api/v1/orders')
        .send({
          items: [
            { productId: retired, quantity: 1 },
            { productId: foreign, quantity: 1 },
            { productId: espresso, quantity: 1 },
          ],
        })
        .expect(400);
      expect(res.body.error).toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
      expect([...res.body.error.details.productIds].sort()).toEqual([retired, foreign].sort());
    });

    it('finds orders by number with or without # and by customer email', async () => {
      const marcus = await contact('Marcus Bell', 'marcus.orders@dailygrind.test');
      const order = await h
        .as(owner, orgId)
        .post('/api/v1/orders')
        .send({ contactId: marcus, items: [{ productId: espresso, quantity: 8 }] })
        .expect(201);

      for (const q of [`${order.body.number}`, `#${order.body.number}`, 'dailygrind']) {
        const res = await h
          .as(agent, orgId)
          .get(`/api/v1/orders?search=${encodeURIComponent(q)}`)
          .expect(200);
        expect(rows<{ id: string }>(res).map((o) => o.id)).toContain(order.body.id);
      }
    });

    it('tracks shipping updates on the order and on the contact timeline', async () => {
      const james = await contact('James Okoro', 'james.orders@example.com');
      const order = await h
        .as(owner, orgId)
        .post('/api/v1/orders')
        .send({ contactId: james, items: [{ productId: espresso, quantity: 1 }] })
        .expect(201);

      const res = await h
        .as(owner, orgId)
        .patch(`/api/v1/orders/${order.body.id}`)
        .send({
          status: 'SHIPPED',
          carrier: 'UPS',
          trackingNumber: '1Z84F1A70391856342',
          estimatedDelivery: '2026-10-08',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'SHIPPED',
        carrier: 'UPS',
        estimatedDelivery: '2026-10-08',
      });

      const activity = await h.as(owner, orgId).get(`/api/v1/contacts/${james}/activity`);
      expect(activity.body.data[0]).toMatchObject({
        type: 'order.status_changed',
        metadata: { from: 'PAID', to: 'SHIPPED' },
      });
    });

    it('counts only money actually received in what a customer has spent', async () => {
      const dan = await contact('Daniel Reyes', 'dan.orders@example.com');
      const kept = await h
        .as(owner, orgId)
        .post('/api/v1/orders')
        .send({ contactId: dan, items: [{ productId: espresso, quantity: 2 }] })
        .expect(201);
      const refunded = await h
        .as(owner, orgId)
        .post('/api/v1/orders')
        .send({ contactId: dan, items: [{ productId: espresso, quantity: 5 }] })
        .expect(201);
      await h
        .as(owner, orgId)
        .patch(`/api/v1/orders/${refunded.body.id}`)
        .send({ status: 'REFUNDED' })
        .expect(200);

      const summary = await h
        .as(agent, orgId)
        .get(`/api/v1/orders/summary?contactId=${dan}`)
        .expect(200);
      expect(summary.body).toMatchObject({
        orderCount: 2,
        totalSpentCents: kept.body.totalCents,
        currency: 'USD',
      });
    });

    it("cannot open another workspace's order", async () => {
      const order = await h
        .as(owner, orgId)
        .post('/api/v1/orders')
        .send({ items: [{ productId: espresso, quantity: 1 }] })
        .expect(201);
      const outsider = await h.person('o-outsider');
      const otherOrg = await h.workspace(outsider, 'E2E Outsider Shop');

      await h.as(outsider, otherOrg).get(`/api/v1/orders/${order.body.id}`).expect(404);
      await h
        .as(outsider, otherOrg)
        .patch(`/api/v1/orders/${order.body.id}`)
        .send({ status: 'CANCELLED' })
        .expect(404);
    });
  });
});

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { OrderStatus } from '../../src/generated/prisma/enums.js';

const PRODUCTS = [
  {
    sku: 'HSE-12',
    name: 'House Espresso, 12 oz',
    category: 'Coffee',
    priceCents: 1700,
    stockQuantity: 140,
  },
  {
    sku: 'ETH-GUJI-12',
    name: 'Ethiopia Guji, 12 oz',
    category: 'Coffee',
    priceCents: 1950,
    stockQuantity: 64,
  },
  {
    sku: 'COL-HUI-12',
    name: 'Colombia Huila, 12 oz',
    category: 'Coffee',
    priceCents: 1800,
    stockQuantity: 88,
  },
  {
    sku: 'DEC-SUM-12',
    name: 'Decaf Sumatra (Swiss Water), 12 oz',
    category: 'Coffee',
    priceCents: 1850,
    stockQuantity: 31,
  },
  {
    sku: 'NSB-2LB',
    name: 'Northstar Blend, 2 lb',
    category: 'Coffee',
    priceCents: 3800,
    stockQuantity: 40,
  },
  {
    sku: 'HSE-5LB',
    name: 'House Espresso, 5 lb (wholesale)',
    category: 'Wholesale',
    priceCents: 7200,
    stockQuantity: 25,
  },
  {
    sku: 'CB-4',
    name: 'Cold Brew Pack, 4 pouches',
    category: 'Coffee',
    priceCents: 1400,
    stockQuantity: 0,
  },
  {
    sku: 'GEAR-DRIP',
    name: 'Ceramic Pour-Over Dripper',
    category: 'Gear',
    priceCents: 2800,
    stockQuantity: 18,
  },
  {
    sku: 'GEAR-FILT',
    name: 'Paper Filters, 100 pack',
    category: 'Gear',
    priceCents: 700,
    stockQuantity: 210,
  },
  {
    sku: 'MERCH-HOOD-BLK-M',
    name: 'Northstar Hoodie, Black (M)',
    category: 'Merch',
    priceCents: 5500,
    stockQuantity: 9,
  },
  {
    sku: 'GIFT-3O',
    name: 'Gift Box: Three Origins',
    category: 'Gifts',
    priceCents: 5200,
    stockQuantity: 22,
  },
  {
    sku: 'SUB-2',
    name: 'Monthly Subscription, 2 bags',
    category: 'Subscription',
    priceCents: 3400,
    stockQuantity: null,
  },
];

interface SeedOrder {
  email: string;
  daysAgo: number;
  status: OrderStatus;
  lines: [sku: string, quantity: number][];
  shipping?: number;
  carrier?: string;
  tracking?: string;
  /** Days from today; negative means it already arrived. */
  deliveryInDays?: number;
}

// Listed oldest first; numbers are assigned in this order starting at 10455,
// which puts Sarah's hoodie at #10482.
const ORDERS: SeedOrder[] = [
  {
    email: 'marcus@thedailygrindcafe.com',
    daysAgo: 88,
    status: 'DELIVERED',
    lines: [['HSE-5LB', 8]],
    shipping: 0,
  },
  { email: 'emily.carter@icloud.com', daysAgo: 85, status: 'DELIVERED', lines: [['SUB-2', 1]] },
  { email: 'james.okoro@outlook.com', daysAgo: 82, status: 'DELIVERED', lines: [['SUB-2', 1]] },
  {
    email: 'olivia.brooks@gmail.com',
    daysAgo: 80,
    status: 'DELIVERED',
    lines: [['GIFT-3O', 2]],
    shipping: 650,
  },
  {
    email: 'leo@fikahouse.co',
    daysAgo: 77,
    status: 'DELIVERED',
    lines: [
      ['HSE-5LB', 4],
      ['DEC-SUM-12', 6],
    ],
    shipping: 0,
  },
  {
    email: 'mia.rossi@gmail.com',
    daysAgo: 74,
    status: 'DELIVERED',
    lines: [
      ['ETH-GUJI-12', 2],
      ['GEAR-DRIP', 1],
    ],
    shipping: 650,
  },
  { email: 'sarah.mitchell@gmail.com', daysAgo: 71, status: 'DELIVERED', lines: [['SUB-2', 1]] },
  {
    email: 'ewalker@fastmail.com',
    daysAgo: 66,
    status: 'DELIVERED',
    lines: [['NSB-2LB', 1]],
    shipping: 650,
  },
  {
    email: 'marcus@thedailygrindcafe.com',
    daysAgo: 60,
    status: 'DELIVERED',
    lines: [['HSE-5LB', 8]],
    shipping: 0,
  },
  {
    email: 'ravi.s@protonmail.com',
    daysAgo: 58,
    status: 'DELIVERED',
    lines: [['COL-HUI-12', 1]],
    shipping: 650,
  },
  {
    email: 'isabella.cruz@hotmail.com',
    daysAgo: 55,
    status: 'DELIVERED',
    lines: [
      ['GIFT-3O', 1],
      ['GEAR-FILT', 2],
    ],
    shipping: 650,
  },
  { email: 'gracekim.ny@gmail.com', daysAgo: 52, status: 'DELIVERED', lines: [['SUB-2', 1]] },
  { email: 'aisha.mohammed@gmail.com', daysAgo: 49, status: 'DELIVERED', lines: [['SUB-2', 1]] },
  {
    email: 'zoe.patterson@gmail.com',
    daysAgo: 46,
    status: 'DELIVERED',
    lines: [
      ['COL-HUI-12', 2],
      ['GEAR-FILT', 1],
    ],
    shipping: 650,
  },
  { email: 'mia.rossi@gmail.com', daysAgo: 43, status: 'DELIVERED', lines: [['SUB-2', 1]] },
  {
    email: 'hannah@lindqvistdesign.se',
    daysAgo: 40,
    status: 'DELIVERED',
    lines: [['GIFT-3O', 12]],
    shipping: 4800,
  },
  {
    email: 'leo@fikahouse.co',
    daysAgo: 36,
    status: 'DELIVERED',
    lines: [['HSE-5LB', 4]],
    shipping: 0,
  },
  {
    email: 'marcus@thedailygrindcafe.com',
    daysAgo: 32,
    status: 'DELIVERED',
    lines: [['HSE-5LB', 10]],
    shipping: 0,
  },
  {
    email: 'ana.sousa@gmail.com',
    daysAgo: 28,
    status: 'DELIVERED',
    lines: [
      ['ETH-GUJI-12', 1],
      ['COL-HUI-12', 1],
    ],
    shipping: 650,
  },
  { email: 'emily.carter@icloud.com', daysAgo: 24, status: 'DELIVERED', lines: [['SUB-2', 1]] },
  { email: 'james.okoro@outlook.com', daysAgo: 21, status: 'DELIVERED', lines: [['SUB-2', 1]] },
  {
    email: 'danreyes88@gmail.com',
    daysAgo: 18,
    status: 'REFUNDED',
    lines: [['NSB-2LB', 1]],
    shipping: 650,
  },
  { email: 'gracekim.ny@gmail.com', daysAgo: 15, status: 'DELIVERED', lines: [['SUB-2', 1]] },
  {
    email: 'zoe.patterson@gmail.com',
    daysAgo: 13,
    status: 'DELIVERED',
    lines: [['DEC-SUM-12', 2]],
    shipping: 650,
  },
  {
    email: 'ana.sousa@gmail.com',
    daysAgo: 10,
    status: 'DELIVERED',
    lines: [
      ['GEAR-DRIP', 1],
      ['GEAR-FILT', 1],
    ],
    shipping: 650,
  },
  {
    email: 'marcus@thedailygrindcafe.com',
    daysAgo: 8,
    status: 'SHIPPED',
    lines: [
      ['HSE-5LB', 8],
      ['DEC-SUM-12', 4],
    ],
    shipping: 0,
    carrier: 'UPS',
    tracking: '1Z84F1A70398410237',
    deliveryInDays: 1,
  },
  {
    email: 'danreyes88@gmail.com',
    daysAgo: 7,
    status: 'DELIVERED',
    lines: [['NSB-2LB', 1]],
    shipping: 0,
  },
  {
    email: 'sarah.mitchell@gmail.com',
    daysAgo: 4,
    status: 'SHIPPED',
    lines: [['MERCH-HOOD-BLK-M', 1]],
    shipping: 650,
    carrier: 'UPS',
    tracking: '1Z84F1A70391856342',
    deliveryInDays: 1,
  },
  {
    email: 'mia.rossi@gmail.com',
    daysAgo: 3,
    status: 'FULFILLED',
    lines: [['ETH-GUJI-12', 2]],
    shipping: 650,
  },
  { email: 'zoe.patterson@gmail.com', daysAgo: 2, status: 'PAID', lines: [['SUB-2', 1]] },
  { email: 'leo@fikahouse.co', daysAgo: 1, status: 'PAID', lines: [['HSE-5LB', 6]], shipping: 0 },
  {
    email: 'gracekim.ny@gmail.com',
    daysAgo: 0,
    status: 'PENDING',
    lines: [
      ['COL-HUI-12', 1],
      ['GEAR-FILT', 1],
    ],
    shipping: 650,
  },
];

const FIRST_NUMBER = 10455;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Idempotent: does nothing if the workspace already has orders. */
export async function seedDemoCommerce(prisma: PrismaClient, organizationId: string) {
  const bySku = new Map<
    string,
    { id: string; name: string; sku: string | null; priceCents: number }
  >();
  for (const p of PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { organizationId_sku: { organizationId, sku: p.sku } },
      update: {},
      create: { organizationId, ...p },
    });
    bySku.set(p.sku, product);
  }

  if ((await prisma.order.count({ where: { organizationId } })) > 0) {
    return { products: PRODUCTS.length, orders: 0 };
  }

  const contacts = await prisma.contact.findMany({
    where: { organizationId, email: { in: ORDERS.map((o) => o.email) } },
    select: { id: true, email: true },
  });
  const contactByEmail = new Map(contacts.map((c) => [c.email, c.id]));

  for (const [index, o] of ORDERS.entries()) {
    const placedAt = new Date(Date.now() - o.daysAgo * DAY_MS - (index % 5) * 3_600_000);
    const items = o.lines.map(([sku, quantity]) => {
      const product = bySku.get(sku)!;
      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unitPriceCents: product.priceCents,
        quantity,
        totalCents: product.priceCents * quantity,
      };
    });
    const subtotalCents = items.reduce((sum, i) => sum + i.totalCents, 0);
    const shippingCents = o.shipping ?? 0;
    const contactId = contactByEmail.get(o.email);

    const order = await prisma.order.create({
      data: {
        organizationId,
        contactId,
        number: FIRST_NUMBER + index,
        status: o.status,
        subtotalCents,
        shippingCents,
        totalCents: subtotalCents + shippingCents,
        carrier: o.carrier,
        trackingNumber: o.tracking,
        estimatedDelivery:
          o.deliveryInDays === undefined
            ? undefined
            : new Date(Date.now() + o.deliveryInDays * DAY_MS),
        placedAt,
        createdAt: placedAt,
        items: { create: items },
      },
    });
    if (contactId) {
      await prisma.contactActivity.create({
        data: {
          organizationId,
          contactId,
          type: 'order.placed',
          metadata: {
            orderId: order.id,
            number: order.number,
            totalCents: order.totalCents,
            currency: 'USD',
          },
          createdAt: placedAt,
        },
      });
    }
  }
  return { products: PRODUCTS.length, orders: ORDERS.length };
}

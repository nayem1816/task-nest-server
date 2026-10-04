import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { LifecycleStage, OrderStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import { ContactActivityService } from '../contacts/contact-activity.service.js';
import { displayName } from '../contacts/contacts.service.js';
import type {
  CreateOrderDto,
  CustomerOrdersSummaryDto,
  ListOrdersQueryDto,
  OrderDto,
  OrderSummaryDto,
  UpdateOrderDto,
} from './commerce.dto.js';

const errors = {
  notFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'That order does not exist.'),
  contactNotFound: () =>
    new AppException(HttpStatus.BAD_REQUEST, 'CONTACT_NOT_FOUND', 'That contact does not exist.'),
  productUnavailable: (ids: string[]) =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'PRODUCT_UNAVAILABLE',
      'Some products do not exist or are archived.',
      { productIds: ids },
    ),
  mixedCurrency: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'MIXED_CURRENCY',
      'All products on one order must use the same currency.',
    ),
};

/** Orders that represent money actually received. */
const REVENUE_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.FULFILLED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

const FIRST_ORDER_NUMBER = 10001;
const NUMBER_ATTEMPTS = 5;

const summaryInclude = {
  contact: { select: { id: true, name: true, email: true, phone: true } },
  _count: { select: { items: true } },
} as const satisfies Prisma.OrderInclude;

const detailInclude = {
  ...summaryInclude,
  items: { orderBy: { id: 'asc' } },
} as const satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ContactActivityService,
  ) {}

  async list(organizationId: string, query: ListOrdersQueryDto) {
    const search = query.search?.trim();
    const asNumber = search ? Number.parseInt(search.replace(/^#/, ''), 10) : NaN;

    const rows = await this.prisma.order.findMany({
      where: {
        organizationId,
        status: query.status,
        contactId: query.contactId,
        ...(search &&
          (Number.isFinite(asNumber) && /^#?\d+$/.test(search)
            ? { number: asNumber }
            : {
                contact: {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                  ],
                },
              })),
        ...(query.cursor && { number: { lt: query.cursor } }),
      },
      include: summaryInclude,
      orderBy: { number: 'desc' },
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const data = (hasMore ? rows.slice(0, query.limit) : rows).map(toSummaryDto);
    return { data, nextCursor: hasMore ? (data.at(-1)?.number ?? null) : null };
  }

  async get(organizationId: string, id: string): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({
      where: { id, organizationId },
      include: detailInclude,
    });
    if (!order) throw errors.notFound();
    return toOrderDto(order);
  }

  /** Lookup by the number customers quote. Used by search and, later, by AI tools. */
  async findByNumber(organizationId: string, number: number): Promise<OrderDto | null> {
    const order = await this.prisma.order.findUnique({
      where: { organizationId_number: { organizationId, number } },
      include: detailInclude,
    });
    return order ? toOrderDto(order) : null;
  }

  async create(actor: RequestActor, dto: CreateOrderDto): Promise<OrderDto> {
    for (let attempt = 0; attempt < NUMBER_ATTEMPTS; attempt++) {
      try {
        const id = await this.createOnce(actor, dto);
        return this.get(actor.organizationId, id);
      } catch (err) {
        // Two orders created at the same moment can pick the same next number;
        // the unique index rejects one, and it simply tries the next number.
        const numberTaken =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          JSON.stringify(err.meta ?? {}).includes('number');
        if (!numberTaken) throw err;
      }
    }
    throw new Error('Could not allocate an order number');
  }

  private createOnce(actor: RequestActor, dto: CreateOrderDto): Promise<string> {
    const { organizationId } = actor;
    return this.prisma.$transaction(async (tx) => {
      const contact = dto.contactId
        ? await tx.contact.findFirst({ where: { id: dto.contactId, organizationId } })
        : null;
      if (dto.contactId && !contact) throw errors.contactNotFound();

      const productIds = [...new Set(dto.items.map((i) => i.productId))];
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, organizationId, status: 'ACTIVE' },
      });
      if (products.length !== productIds.length) {
        const found = new Set(products.map((p) => p.id));
        throw errors.productUnavailable(productIds.filter((id) => !found.has(id)));
      }
      const currencies = new Set(products.map((p) => p.currency));
      if (currencies.size > 1) throw errors.mixedCurrency();

      const byId = new Map(products.map((p) => [p.id, p]));
      const items = dto.items.map((line) => {
        const product = byId.get(line.productId)!;
        return {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unitPriceCents: product.priceCents,
          quantity: line.quantity,
          totalCents: product.priceCents * line.quantity,
        };
      });
      const subtotalCents = items.reduce((sum, i) => sum + i.totalCents, 0);
      const shippingCents = dto.shippingCents ?? 0;

      const last = await tx.order.aggregate({ where: { organizationId }, _max: { number: true } });
      const number = Math.max((last._max.number ?? 0) + 1, FIRST_ORDER_NUMBER);
      const status = dto.status ?? OrderStatus.PAID;

      const order = await tx.order.create({
        data: {
          organizationId,
          contactId: contact?.id,
          number,
          status,
          currency: products[0]!.currency,
          subtotalCents,
          shippingCents,
          totalCents: subtotalCents + shippingCents,
          shippingAddress: dto.shippingAddress,
          items: { create: items },
        },
      });

      if (contact) {
        // Placing an order is what makes someone a customer.
        await tx.contact.update({
          where: { id: contact.id },
          data: { stage: LifecycleStage.CUSTOMER, lastSeenAt: new Date() },
        });
        await this.activity.record(
          {
            organizationId,
            contactId: contact.id,
            type: 'order.placed',
            actor: { id: actor.userId, label: actor.label },
            metadata: {
              orderId: order.id,
              number,
              totalCents: order.totalCents,
              currency: order.currency,
            },
          },
          tx,
        );
      }
      return order.id;
    });
  }

  async update(actor: RequestActor, id: string, dto: UpdateOrderDto): Promise<OrderDto> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.order.findFirst({
        where: { id, organizationId: actor.organizationId },
      });
      if (!before) throw errors.notFound();

      await tx.order.update({
        where: { id },
        data: {
          status: dto.status,
          carrier: dto.carrier,
          trackingNumber: dto.trackingNumber,
          estimatedDelivery:
            dto.estimatedDelivery === undefined
              ? undefined
              : dto.estimatedDelivery && new Date(dto.estimatedDelivery),
        },
      });

      if (dto.status && dto.status !== before.status && before.contactId) {
        await this.activity.record(
          {
            organizationId: actor.organizationId,
            contactId: before.contactId,
            type: 'order.status_changed',
            actor: { id: actor.userId, label: actor.label },
            metadata: { orderId: id, number: before.number, from: before.status, to: dto.status },
          },
          tx,
        );
      }
    });
    return this.get(actor.organizationId, id);
  }

  async summaryForContact(
    organizationId: string,
    contactId: string,
  ): Promise<CustomerOrdersSummaryDto> {
    const [all, paid] = await Promise.all([
      this.prisma.order.aggregate({
        where: { organizationId, contactId },
        _count: true,
        _max: { placedAt: true },
      }),
      this.prisma.order.groupBy({
        by: ['currency'],
        where: { organizationId, contactId, status: { in: REVENUE_STATUSES } },
        _sum: { totalCents: true },
        orderBy: { _sum: { totalCents: 'desc' } },
      }),
    ]);
    // Contacts normally buy in one currency; the largest is the headline figure.
    const main = paid[0];
    return {
      orderCount: all._count,
      totalSpentCents: main?._sum.totalCents ?? 0,
      currency: main?.currency ?? 'USD',
      lastOrderAt: all._max.placedAt,
    };
  }
}

type SummaryRow = Prisma.OrderGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.OrderGetPayload<{ include: typeof detailInclude }>;

function toSummaryDto(o: SummaryRow): OrderSummaryDto {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    currency: o.currency,
    totalCents: o.totalCents,
    itemCount: o._count.items,
    placedAt: o.placedAt,
    contact: o.contact
      ? { id: o.contact.id, displayName: displayName(o.contact), email: o.contact.email }
      : null,
  };
}

function toOrderDto(o: DetailRow): OrderDto {
  return {
    ...toSummaryDto(o),
    subtotalCents: o.subtotalCents,
    shippingCents: o.shippingCents,
    shippingAddress: o.shippingAddress,
    carrier: o.carrier,
    trackingNumber: o.trackingNumber,
    estimatedDelivery: o.estimatedDelivery ? o.estimatedDelivery.toISOString().slice(0, 10) : null,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.name,
      sku: i.sku,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      totalCents: i.totalCents,
    })),
  };
}

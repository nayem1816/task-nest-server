import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';
import { Prisma, type Product } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  ProductDto,
  UpdateProductDto,
} from './commerce.dto.js';

const errors = {
  notFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'That product does not exist.'),
  skuTaken: () =>
    new AppException(HttpStatus.CONFLICT, 'SKU_TAKEN', 'Another product already uses this SKU.'),
};

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: ListProductsQueryDto) {
    const search = query.search?.trim();
    const rows = await this.prisma.product.findMany({
      where: {
        organizationId,
        status: query.status,
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
            { category: { contains: search, mode: 'insensitive' } },
          ],
        }),
        ...(query.cursor && { id: { lt: query.cursor } }),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const data = (hasMore ? rows.slice(0, query.limit) : rows).map(toProductDto);
    return { data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
  }

  async get(organizationId: string, id: string): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({ where: { id, organizationId } });
    if (!product) throw errors.notFound();
    return toProductDto(product);
  }

  async create(organizationId: string, dto: CreateProductDto): Promise<ProductDto> {
    return this.withSkuCheck(async () =>
      toProductDto(await this.prisma.product.create({ data: { organizationId, ...dto } })),
    );
  }

  async update(organizationId: string, id: string, dto: UpdateProductDto): Promise<ProductDto> {
    return this.withSkuCheck(async () => {
      const existing = await this.prisma.product.findFirst({ where: { id, organizationId } });
      if (!existing) throw errors.notFound();
      return toProductDto(await this.prisma.product.update({ where: { id }, data: dto }));
    });
  }

  private async withSkuCheck<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw errors.skuTaken();
      }
      throw err;
    }
  }
}

export function toProductDto(p: Product): ProductDto {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    description: p.description,
    category: p.category,
    priceCents: p.priceCents,
    currency: p.currency,
    stockQuantity: p.stockQuantity,
    status: p.status,
    createdAt: p.createdAt,
  };
}

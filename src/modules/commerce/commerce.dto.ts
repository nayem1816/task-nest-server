import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderStatus, ProductStatus } from '../../generated/prisma/enums.js';

const blankToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const MAX_CENTS = 100_000_000; // $1,000,000: generous, but catches a misplaced decimal.

// ─── Products ────────────────────────────────────────────────────────────────

export class CreateProductDto {
  /** @example "Ethiopia Guji, 12 oz" */
  @Transform(blankToNull)
  @IsString()
  @Length(1, 120)
  name!: string;

  /** @example "ETH-GUJI-12" */
  @IsOptional()
  @Transform(blankToNull)
  @Matches(/^[A-Za-z0-9._-]{1,40}$/, { message: 'sku can use letters, digits, . _ and -' })
  sku?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  /** @example "Coffee" */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(60)
  category?: string | null;

  /** In cents. @example 1900 */
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  priceCents!: number;

  /** ISO 4217. @example "USD" */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  /** Leave empty if stock is not tracked. */
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number | null;
}

export class UpdateProductDto {
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @Transform(blankToNull)
  @Matches(/^[A-Za-z0-9._-]{1,40}$/, { message: 'sku can use letters, digits, . _ and -' })
  sku?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(60)
  category?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  priceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number | null;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}

export class ListProductsQueryDto {
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class ProductDto {
  id!: string;
  name!: string;
  sku!: string | null;
  description!: string | null;
  category!: string | null;
  priceCents!: number;
  currency!: string;
  stockQuantity!: number | null;
  status!: ProductStatus;
  createdAt!: Date;
}

export class ProductPageDto {
  data!: ProductDto[];
  nextCursor!: string | null;
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export class OrderLineInputDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

export class CreateOrderDto {
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  items!: OrderLineInputDto[];

  /** In cents. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  shippingCents?: number;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(300)
  shippingAddress?: string | null;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class UpdateOrderDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /** @example "UPS" */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(40)
  carrier?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(60)
  trackingNumber?: string | null;

  /** @example "2026-10-08" */
  @IsOptional()
  @Transform(blankToNull)
  @IsDateString({ strict: true })
  estimatedDelivery?: string | null;
}

export class ListOrdersQueryDto {
  /** An order number ("10482" or "#10482"), or part of the customer's name or email. */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  /** `nextCursor` from the previous page. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class OrderContactDto {
  id!: string;
  displayName!: string;
  email!: string | null;
}

export class OrderItemDto {
  id!: string;
  productId!: string | null;
  name!: string;
  sku!: string | null;
  unitPriceCents!: number;
  quantity!: number;
  totalCents!: number;
}

export class OrderSummaryDto {
  id!: string;
  number!: number;
  status!: OrderStatus;
  currency!: string;
  totalCents!: number;
  itemCount!: number;
  placedAt!: Date;
  contact!: OrderContactDto | null;
}

export class OrderDto extends OrderSummaryDto {
  subtotalCents!: number;
  shippingCents!: number;
  shippingAddress!: string | null;
  carrier!: string | null;
  trackingNumber!: string | null;
  /** Calendar date, YYYY-MM-DD. */
  estimatedDelivery!: string | null;
  items!: OrderItemDto[];
}

export class OrderPageDto {
  data!: OrderSummaryDto[];
  /** Pass back as `cursor`; orders are listed newest number first. */
  nextCursor!: number | null;
}

export class CustomerOrdersSummaryDto {
  orderCount!: number;
  /** Paid, shipped or delivered orders only; refunds and cancellations excluded. */
  totalSpentCents!: number;
  currency!: string;
  lastOrderAt!: Date | null;
}

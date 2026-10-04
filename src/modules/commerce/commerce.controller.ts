import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  Actor,
  CurrentTenant,
  type RequestActor,
  RequirePermissions,
  type TenantContext,
} from '../authorization/tenant.decorators.js';
import {
  CreateOrderDto,
  CreateProductDto,
  CustomerOrdersSummaryDto,
  ListOrdersQueryDto,
  ListProductsQueryDto,
  OrderDto,
  OrderPageDto,
  ProductDto,
  ProductPageDto,
  UpdateOrderDto,
  UpdateProductDto,
} from './commerce.dto.js';
import { OrdersService } from './orders.service.js';
import { ProductsService } from './products.service.js';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('commerce.read')
  @ApiOperation({ summary: 'The catalogue, newest first' })
  @ApiOkResponse({ type: ProductPageDto })
  list(@CurrentTenant() t: TenantContext, @Query() query: ListProductsQueryDto) {
    return this.products.list(t.organizationId, query);
  }

  @Post()
  @RequirePermissions('commerce.manage')
  @ApiOperation({ summary: 'Add a product' })
  @ApiCreatedResponse({ type: ProductDto })
  create(@CurrentTenant() t: TenantContext, @Body() dto: CreateProductDto) {
    return this.products.create(t.organizationId, dto);
  }

  @Get(':id')
  @RequirePermissions('commerce.read')
  @ApiOkResponse({ type: ProductDto })
  get(@CurrentTenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.get(t.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('commerce.manage')
  @ApiOperation({ summary: 'Edit a product, or archive it so it cannot be ordered' })
  @ApiOkResponse({ type: ProductDto })
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(t.organizationId, id, dto);
  }
}

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('commerce.read')
  @ApiOperation({ summary: 'Orders, newest first. Search by order number or customer.' })
  @ApiOkResponse({ type: OrderPageDto })
  list(@CurrentTenant() t: TenantContext, @Query() query: ListOrdersQueryDto) {
    return this.orders.list(t.organizationId, query);
  }

  @Get('summary')
  @RequirePermissions('commerce.read')
  @ApiOperation({ summary: 'How much a contact has ordered and spent' })
  @ApiQuery({ name: 'contactId', required: true })
  @ApiOkResponse({ type: CustomerOrdersSummaryDto })
  summary(@CurrentTenant() t: TenantContext, @Query('contactId', ParseUUIDPipe) contactId: string) {
    return this.orders.summaryForContact(t.organizationId, contactId);
  }

  @Post()
  @RequirePermissions('commerce.manage')
  @ApiOperation({
    summary: 'Record an order',
    description: 'Prices come from the catalogue. Linking a contact makes them a customer.',
  })
  @ApiCreatedResponse({ type: OrderDto })
  create(@Actor() actor: RequestActor, @Body() dto: CreateOrderDto) {
    return this.orders.create(actor, dto);
  }

  @Get(':id')
  @RequirePermissions('commerce.read')
  @ApiOkResponse({ type: OrderDto })
  get(@CurrentTenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(t.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('commerce.manage')
  @ApiOperation({ summary: 'Update status, carrier, tracking number or delivery estimate' })
  @ApiOkResponse({ type: OrderDto })
  update(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.orders.update(actor, id, dto);
  }
}

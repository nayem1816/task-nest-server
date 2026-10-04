import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module.js';
import { OrdersController, ProductsController } from './commerce.controller.js';
import { OrdersService } from './orders.service.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [ContactsModule],
  controllers: [ProductsController, OrdersController],
  providers: [ProductsService, OrdersService],
  exports: [ProductsService, OrdersService],
})
export class CommerceModule {}

import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module.js';
import { InboxModule } from '../inbox/inbox.module.js';
import { VisitorTokenService } from './visitor-token.service.js';
import { WidgetController } from './widget.controller.js';
import { WidgetGateway } from './widget.gateway.js';
import { WidgetService } from './widget.service.js';

@Module({
  imports: [ContactsModule, InboxModule],
  controllers: [WidgetController],
  providers: [WidgetService, VisitorTokenService, WidgetGateway],
})
export class WidgetModule {}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Actor,
  type RequestActor,
  RequirePermissions,
} from '../authorization/tenant.decorators.js';
import { ConversationsService } from './conversations.service.js';
import {
  AssignConversationDto,
  ConversationDto,
  ConversationPageDto,
  InboxCountsDto,
  ListConversationsQueryDto,
  MessageDto,
  MessagePageDto,
  MessagesQueryDto,
  SendMessageDto,
  SetConversationTagsDto,
  UpdateConversationDto,
} from './inbox.dto.js';
import { MessagesService } from './messages.service.js';

@ApiTags('Inbox')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
  ) {}

  @Get()
  @RequirePermissions('conversation.read')
  @ApiOperation({ summary: 'Conversations, most recent activity first, with filters' })
  @ApiOkResponse({ type: ConversationPageDto })
  list(@Actor() actor: RequestActor, @Query() query: ListConversationsQueryDto) {
    return this.conversations.list(actor, query);
  }

  @Get('counts')
  @RequirePermissions('conversation.read')
  @ApiOperation({ summary: 'How many open conversations are in each inbox view' })
  @ApiOkResponse({ type: InboxCountsDto })
  counts(@Actor() actor: RequestActor) {
    return this.conversations.counts(actor);
  }

  @Get(':id')
  @RequirePermissions('conversation.read')
  @ApiOkResponse({ type: ConversationDto })
  get(@Actor() actor: RequestActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.get(actor, id);
  }

  @Patch(':id')
  @RequirePermissions('conversation.manage')
  @ApiOperation({ summary: 'Change status or priority; status changes are noted in the thread' })
  @ApiOkResponse({ type: ConversationDto })
  update(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversations.update(actor, id, dto);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('conversation.assign')
  @ApiOperation({ summary: 'Assign to a member and/or team, or unassign with null' })
  @ApiOkResponse({ type: ConversationDto })
  assign(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignConversationDto,
  ) {
    return this.conversations.assign(actor, id, dto);
  }

  @Put(':id/tags')
  @RequirePermissions('conversation.manage')
  @ApiOperation({ summary: 'Set exactly which tags a conversation has' })
  @ApiOkResponse({ type: ConversationDto })
  setTags(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetConversationTagsDto,
  ) {
    return this.conversations.setTags(actor, id, dto.tagIds);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('conversation.read')
  @ApiOperation({ summary: 'Mark everything in the conversation as read for you' })
  @ApiNoContentResponse()
  async markRead(@Actor() actor: RequestActor, @Param('id', ParseUUIDPipe) id: string) {
    await this.conversations.markRead(actor, id);
  }

  @Get(':id/messages')
  @RequirePermissions('conversation.read')
  @ApiOperation({ summary: 'Messages and notes, a page at a time going back in time' })
  @ApiOkResponse({ type: MessagePageDto })
  listMessages(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.messages.list(actor, id, query.limit, query.before);
  }

  @Post(':id/messages')
  @RequirePermissions('conversation.reply')
  @ApiOperation({
    summary: 'Reply to the customer, or add an internal note',
    description:
      'A reply takes the conversation over from the AI, reopens it if resolved, and ' +
      'assigns it to you if nobody had it.',
  })
  @ApiCreatedResponse({ type: MessageDto })
  send(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.send(actor, id, dto.body, dto.internal ?? false);
  }
}

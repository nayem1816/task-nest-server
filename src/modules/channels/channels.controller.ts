import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Actor,
  type RequestActor,
  RequirePermissions,
} from '../authorization/tenant.decorators.js';
import { ChannelDto, CreateWebsiteChannelDto, UpdateChannelDto } from './channels.dto.js';
import { ChannelsService } from './channels.service.js';

@ApiTags('Channels')
@ApiBearerAuth()
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @RequirePermissions('channel.manage')
  @ApiOperation({ summary: 'Channels connected to the workspace' })
  @ApiOkResponse({ type: [ChannelDto] })
  list(@Actor() actor: RequestActor) {
    return this.channels.list(actor.organizationId);
  }

  @Post('website')
  @RequirePermissions('channel.manage')
  @ApiOperation({ summary: 'Add a website chat channel' })
  @ApiCreatedResponse({ type: ChannelDto })
  createWebsite(@Actor() actor: RequestActor, @Body() dto: CreateWebsiteChannelDto) {
    return this.channels.createWebsite(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions('channel.manage')
  @ApiOperation({ summary: 'Rename, turn off, or change website chat settings' })
  @ApiOkResponse({ type: ChannelDto })
  update(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.channels.update(actor, id, dto);
  }
}

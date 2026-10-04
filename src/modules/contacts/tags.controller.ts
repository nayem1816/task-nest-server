import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  CurrentTenant,
  type RequestActor,
  RequirePermissions,
  type TenantContext,
} from '../authorization/tenant.decorators.js';
import { CreateTagDto, TagDto, TagWithUsageDto, UpdateTagDto } from './contacts.dto.js';
import { TagsService } from './tags.service.js';

@ApiTags('Tags')
@ApiBearerAuth()
@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @RequirePermissions('contact.read')
  @ApiOperation({ summary: 'Tags in this workspace and how many contacts use each' })
  @ApiOkResponse({ type: [TagWithUsageDto] })
  list(@CurrentTenant() tenant: TenantContext): Promise<TagWithUsageDto[]> {
    return this.tags.list(tenant.organizationId);
  }

  @Post()
  @RequirePermissions('contact.update')
  @ApiOperation({ summary: 'Create a tag' })
  @ApiCreatedResponse({ type: TagDto })
  create(@Actor() actor: RequestActor, @Body() dto: CreateTagDto): Promise<TagDto> {
    return this.tags.create(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions('contact.update')
  @ApiOperation({ summary: 'Rename or recolor a tag' })
  @ApiOkResponse({ type: TagDto })
  update(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTagDto,
  ): Promise<TagDto> {
    return this.tags.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('contact.delete')
  @ApiOperation({ summary: 'Delete a tag and remove it from every contact' })
  @ApiNoContentResponse()
  async remove(@Actor() actor: RequestActor, @Param('id', ParseUUIDPipe) id: string) {
    await this.tags.remove(actor, id);
  }
}

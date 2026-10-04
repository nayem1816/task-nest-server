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
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
import { ContactActivityService } from './contact-activity.service.js';
import {
  ActivityPageDto,
  ContactDetailDto,
  ContactPageDto,
  CreateContactDto,
  CreateNoteDto,
  ListContactsQueryDto,
  NoteDto,
  NotePageDto,
  PageQueryDto,
  SetContactTagsDto,
  UpdateContactDto,
} from './contacts.dto.js';
import { ContactsService } from './contacts.service.js';
import { NotesService } from './notes.service.js';

@ApiTags('Contacts')
@ApiBearerAuth()
@Controller('contacts')
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly notes: NotesService,
    private readonly activity: ContactActivityService,
  ) {}

  @Get()
  @RequirePermissions('contact.read')
  @ApiOperation({ summary: 'Contacts, newest first, with search and filters' })
  @ApiOkResponse({ type: ContactPageDto })
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListContactsQueryDto,
  ): Promise<ContactPageDto> {
    return this.contacts.list(tenant.organizationId, query);
  }

  @Post()
  @RequirePermissions('contact.update')
  @ApiOperation({ summary: 'Add a contact by hand' })
  @ApiCreatedResponse({ type: ContactDetailDto })
  @ApiConflictResponse({ description: '`CONTACT_EMAIL_TAKEN`, with the existing contact id' })
  create(@Actor() actor: RequestActor, @Body() dto: CreateContactDto): Promise<ContactDetailDto> {
    return this.contacts.create(actor, dto);
  }

  @Get(':id')
  @RequirePermissions('contact.read')
  @ApiOperation({ summary: 'One contact with tags and channel identities' })
  @ApiOkResponse({ type: ContactDetailDto })
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContactDetailDto> {
    return this.contacts.get(tenant.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('contact.update')
  @ApiOperation({ summary: 'Edit contact details; send null or "" to clear a field' })
  @ApiOkResponse({ type: ContactDetailDto })
  update(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
  ): Promise<ContactDetailDto> {
    return this.contacts.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('contact.delete')
  @ApiOperation({ summary: 'Delete a contact with its notes and history' })
  @ApiNoContentResponse()
  async remove(@Actor() actor: RequestActor, @Param('id', ParseUUIDPipe) id: string) {
    await this.contacts.remove(actor, id);
  }

  @Put(':id/tags')
  @RequirePermissions('contact.update')
  @ApiOperation({ summary: 'Set exactly which tags a contact has' })
  @ApiOkResponse({ type: ContactDetailDto })
  setTags(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetContactTagsDto,
  ): Promise<ContactDetailDto> {
    return this.contacts.setTags(actor, id, dto.tagIds);
  }

  @Get(':id/activity')
  @RequirePermissions('contact.read')
  @ApiOperation({ summary: "The contact's timeline, newest first" })
  @ApiOkResponse({ type: ActivityPageDto })
  async listActivity(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ): Promise<ActivityPageDto> {
    await this.contacts.get(tenant.organizationId, id);
    const page = await this.activity.list(tenant.organizationId, id, query.limit, query.cursor);
    return {
      nextCursor: page.nextCursor,
      data: page.data.map((a) => ({
        id: a.id,
        type: a.type,
        actorLabel: a.actorLabel,
        metadata: a.metadata as Record<string, unknown> | null,
        createdAt: a.createdAt,
      })),
    };
  }

  @Get(':id/notes')
  @RequirePermissions('contact.read')
  @ApiOperation({ summary: 'Internal notes about the contact, newest first' })
  @ApiOkResponse({ type: NotePageDto })
  listNotes(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ): Promise<NotePageDto> {
    return this.notes.list(tenant.organizationId, id, query.limit, query.cursor);
  }

  @Post(':id/notes')
  @RequirePermissions('contact.update')
  @ApiOperation({ summary: 'Add an internal note. Customers never see notes.' })
  @ApiCreatedResponse({ type: NoteDto })
  addNote(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
  ): Promise<NoteDto> {
    return this.notes.create(actor, id, dto.body);
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('contact.update')
  @ApiOperation({ summary: 'Delete a note you wrote (or any note with contact.delete)' })
  @ApiNoContentResponse()
  async removeNote(
    @Actor() actor: RequestActor,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    await this.notes.remove(actor, id, noteId, tenant.permissions.has('contact.delete'));
  }
}

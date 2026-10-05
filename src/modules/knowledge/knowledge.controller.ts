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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  Actor,
  type RequestActor,
  RequirePermissions,
} from '../authorization/tenant.decorators.js';
import { KnowledgeSearchService } from './knowledge-search.service.js';
import {
  CreateFileSourceDto,
  CreateTextSourceDto,
  CreateUrlSourceDto,
  KnowledgeSearchDto,
  KnowledgeSearchResultDto,
  KnowledgeSourceDetailDto,
  KnowledgeSourceDto,
  UpdateSourceDto,
} from './knowledge.dto.js';
import { KnowledgeService, type UploadedFile as Upload } from './knowledge.service.js';
import { KNOWLEDGE_LIMITS } from './knowledge.types.js';

@ApiTags('Knowledge')
@ApiBearerAuth()
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly search: KnowledgeSearchService,
  ) {}

  @Get('sources')
  @RequirePermissions('knowledge.read')
  @ApiOperation({ summary: 'Knowledge sources, newest first' })
  @ApiOkResponse({ type: [KnowledgeSourceDto] })
  list(@Actor() actor: RequestActor) {
    return this.knowledge.list(actor.organizationId);
  }

  @Get('sources/:id')
  @RequirePermissions('knowledge.read')
  @ApiOperation({ summary: 'A source with its text and the passages made from it' })
  @ApiOkResponse({ type: KnowledgeSourceDetailDto })
  get(@Actor() actor: RequestActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.get(actor.organizationId, id);
  }

  @Post('sources/text')
  @RequirePermissions('knowledge.manage')
  @ApiOperation({ summary: 'Add a written article' })
  @ApiCreatedResponse({ type: KnowledgeSourceDto })
  createText(@Actor() actor: RequestActor, @Body() dto: CreateTextSourceDto) {
    return this.knowledge.createText(actor, dto);
  }

  @Post('sources/url')
  @RequirePermissions('knowledge.manage')
  @ApiOperation({ summary: 'Add a public web page' })
  @ApiCreatedResponse({ type: KnowledgeSourceDto })
  createUrl(@Actor() actor: RequestActor, @Body() dto: CreateUrlSourceDto) {
    return this.knowledge.createUrl(actor, dto);
  }

  @Post('sources/file')
  @RequirePermissions('knowledge.manage')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: KNOWLEDGE_LIMITS.fileBytes } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF, Word, text, Markdown or HTML, up to 10 MB',
        },
        title: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a document' })
  @ApiCreatedResponse({ type: KnowledgeSourceDto })
  createFile(
    @Actor() actor: RequestActor,
    @UploadedFile() file: Upload | undefined,
    @Body() dto: CreateFileSourceDto,
  ) {
    return this.knowledge.createFile(actor, file, dto.title);
  }

  @Patch('sources/:id')
  @RequirePermissions('knowledge.manage')
  @ApiOperation({ summary: 'Rename a source, or edit a written one (re-indexes it)' })
  @ApiOkResponse({ type: KnowledgeSourceDto })
  update(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSourceDto,
  ) {
    return this.knowledge.update(actor, id, dto);
  }

  @Post('sources/:id/reindex')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('knowledge.manage')
  @ApiOperation({ summary: 'Read the source again and rebuild its passages' })
  @ApiOkResponse({ type: KnowledgeSourceDto })
  reindex(@Actor() actor: RequestActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.reindex(actor, id);
  }

  @Delete('sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('knowledge.manage')
  @ApiOperation({ summary: 'Remove a source; the AI stops using it at once' })
  @ApiNoContentResponse()
  remove(@Actor() actor: RequestActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.remove(actor, id);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('knowledge.read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Find the passages that best answer a question' })
  @ApiOkResponse({ type: [KnowledgeSearchResultDto] })
  searchKnowledge(@Actor() actor: RequestActor, @Body() dto: KnowledgeSearchDto) {
    return this.search.search(actor.organizationId, dto.query, dto.limit ?? 5);
  }
}

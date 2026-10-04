import { Module } from '@nestjs/common';
import { ContactActivityService } from './contact-activity.service.js';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';
import { NotesService } from './notes.service.js';
import { TagsController } from './tags.controller.js';
import { TagsService } from './tags.service.js';

@Module({
  controllers: [ContactsController, TagsController],
  providers: [ContactsService, ContactActivityService, NotesService, TagsService],
  exports: [ContactsService, ContactActivityService],
})
export class ContactsModule {}

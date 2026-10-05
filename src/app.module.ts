import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { AppLoggerModule } from './infrastructure/logging/logger.module.js';
import { MailModule } from './infrastructure/mail/mail.module.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { RateLimitModule } from './infrastructure/rate-limit/rate-limit.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';
import { CommerceModule } from './modules/commerce/commerce.module.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InboxModule } from './modules/inbox/inbox.module.js';
import { InvitationsModule } from './modules/invitations/invitations.module.js';
import { MembersModule } from './modules/members/members.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { TeamsModule } from './modules/teams/teams.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    AppLoggerModule,
    EventEmitterModule.forRoot(),
    DatabaseModule,
    RedisModule,
    QueueModule,
    MailModule,
    AuditModule,
    // Global guards run in import order: rate limiting, then authentication,
    // then the tenant and permission check, which needs the authenticated user.
    RateLimitModule,
    AuthModule,
    AuthorizationModule,
    HealthModule,
    OrganizationsModule,
    MembersModule,
    TeamsModule,
    InvitationsModule,
    ContactsModule,
    CommerceModule,
    InboxModule,
  ],
})
export class AppModule {}

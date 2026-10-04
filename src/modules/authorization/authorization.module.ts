import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RolesController } from './roles.controller.js';
import { TenantGuard } from './tenant.guard.js';

@Module({
  controllers: [RolesController],
  providers: [{ provide: APP_GUARD, useClass: TenantGuard }],
})
export class AuthorizationModule {}

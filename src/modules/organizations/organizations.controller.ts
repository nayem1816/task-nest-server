import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { type AuthContext, CurrentAuth } from '../auth/auth.decorators.js';
import {
  Actor,
  CurrentTenant,
  ORGANIZATION_HEADER,
  type RequestActor,
  RequirePermissions,
  type TenantContext,
} from '../authorization/tenant.decorators.js';
import { UsersService } from '../users/users.service.js';
import {
  CreateOrganizationDto,
  MyOrganizationDto,
  OrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization.dto.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly users: UsersService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @ApiOperation({ summary: 'Create a workspace; you become its owner' })
  @ApiCreatedResponse({ type: MyOrganizationDto })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateOrganizationDto,
    @Req() req: Request,
  ): Promise<MyOrganizationDto> {
    const user = await this.users.findById(auth.userId);
    return this.organizations.create(
      {
        userId: auth.userId,
        name: user?.name ?? 'Unknown',
        ip: req.clientIp ?? req.ip,
        userAgent: req.headers['user-agent'],
      },
      dto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Workspaces you belong to, with your role in each' })
  @ApiOkResponse({ type: [MyOrganizationDto] })
  listMine(@CurrentAuth() auth: AuthContext): Promise<MyOrganizationDto[]> {
    return this.organizations.listForUser(auth.userId);
  }

  @Get('current')
  @RequirePermissions()
  @ApiHeader({ name: ORGANIZATION_HEADER, required: true })
  @ApiOperation({ summary: 'The workspace selected by the organization header' })
  @ApiOkResponse({ type: OrganizationDto })
  current(@CurrentTenant() tenant: TenantContext): Promise<OrganizationDto> {
    return this.organizations.get(tenant.organizationId);
  }

  @Patch('current')
  @RequirePermissions('settings.manage')
  @ApiHeader({ name: ORGANIZATION_HEADER, required: true })
  @ApiOperation({ summary: 'Rename the workspace or change its business type or time zone' })
  @ApiOkResponse({ type: OrganizationDto })
  update(
    @Actor() actor: RequestActor,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrganizationDto> {
    return this.organizations.update(actor, dto);
  }
}

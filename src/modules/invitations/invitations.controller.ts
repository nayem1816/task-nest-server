import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { type AuthContext, CurrentAuth, Public } from '../auth/auth.decorators.js';
import {
  Actor,
  CurrentTenant,
  type RequestActor,
  RequirePermissions,
  type TenantContext,
} from '../authorization/tenant.decorators.js';
import { MyOrganizationDto } from '../organizations/dto/organization.dto.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import {
  CreateInvitationDto,
  InvitationDto,
  InvitationPreviewDto,
  InvitationTokenDto,
} from './invitations.dto.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('Invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Post()
  @RequirePermissions('team.manage')
  @Throttle({ default: { limit: 30, ttl: 60 * 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invite someone by email; replaces any pending invitation for them' })
  @ApiCreatedResponse({ type: InvitationDto })
  create(@Actor() actor: RequestActor, @Body() dto: CreateInvitationDto): Promise<InvitationDto> {
    return this.invitations.create(actor, dto);
  }

  @Get()
  @RequirePermissions('team.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invitations that have not been accepted, revoked or expired' })
  @ApiOkResponse({ type: [InvitationDto] })
  list(@CurrentTenant() tenant: TenantContext): Promise<InvitationDto[]> {
    return this.invitations.listPending(tenant.organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('team.manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a pending invitation' })
  @ApiNoContentResponse()
  async revoke(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.invitations.revoke(actor, id);
  }

  @Public()
  @Get('preview')
  @Throttle({ default: { limit: 30, ttl: 15 * 60_000 } })
  @ApiOperation({ summary: 'Who invited you, to which workspace, as what role' })
  @ApiOkResponse({ type: InvitationPreviewDto })
  preview(@Query() query: InvitationTokenDto): Promise<InvitationPreviewDto> {
    return this.invitations.preview(query.token);
  }

  @Post('accept')
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Join the workspace',
    description: 'You must be signed in with the email address the invitation was sent to.',
  })
  @ApiOkResponse({ type: MyOrganizationDto })
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: InvitationTokenDto,
    @Req() req: Request,
  ): Promise<MyOrganizationDto> {
    const { organizationId } = await this.invitations.accept(auth.userId, dto.token, {
      ip: req.clientIp ?? req.ip,
      userAgent: req.headers['user-agent'],
    });
    const mine = await this.organizations.listForUser(auth.userId);
    return mine.find((o) => o.id === organizationId)!;
  }
}

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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Actor,
  CurrentTenant,
  ORGANIZATION_HEADER,
  type RequestActor,
  RequirePermissions,
  type TenantContext,
} from '../authorization/tenant.decorators.js';
import { MemberDto, UpdateMemberDto } from './members.dto.js';
import { MembersService } from './members.service.js';

@ApiTags('Members')
@ApiBearerAuth()
@ApiHeader({ name: ORGANIZATION_HEADER, required: true })
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermissions('team.read')
  @ApiOperation({ summary: 'Everyone in this workspace, with role and teams' })
  @ApiOkResponse({ type: [MemberDto] })
  list(@CurrentTenant() tenant: TenantContext): Promise<MemberDto[]> {
    return this.members.list(tenant.organizationId);
  }

  @Patch(':id')
  @RequirePermissions('team.manage')
  @ApiOperation({
    summary: 'Change a member’s role, or disable and re-enable their access',
    description:
      'You cannot change yourself. Only owners can grant the owner role or change another owner.',
  })
  @ApiOkResponse({ type: MemberDto })
  update(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberDto> {
    return this.members.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('team.manage')
  @ApiOperation({ summary: 'Remove someone from the workspace' })
  @ApiNoContentResponse()
  async remove(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.members.remove(actor, id);
  }
}

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
import { CreateTeamDto, SetTeamMembersDto, TeamDto, UpdateTeamDto } from './teams.dto.js';
import { TeamsService } from './teams.service.js';

@ApiTags('Teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermissions('team.read')
  @ApiOperation({ summary: 'Teams in this workspace and who is on each' })
  @ApiOkResponse({ type: [TeamDto] })
  list(@CurrentTenant() tenant: TenantContext): Promise<TeamDto[]> {
    return this.teams.list(tenant.organizationId);
  }

  @Post()
  @RequirePermissions('team.manage')
  @ApiOperation({ summary: 'Create a team' })
  @ApiCreatedResponse({ type: TeamDto })
  create(@Actor() actor: RequestActor, @Body() dto: CreateTeamDto): Promise<TeamDto> {
    return this.teams.create(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions('team.manage')
  @ApiOperation({ summary: 'Rename a team or change its description' })
  @ApiOkResponse({ type: TeamDto })
  update(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamDto> {
    return this.teams.update(actor, id, dto);
  }

  @Put(':id/members')
  @RequirePermissions('team.manage')
  @ApiOperation({ summary: 'Set exactly who is on a team' })
  @ApiOkResponse({ type: TeamDto })
  setMembers(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTeamMembersDto,
  ): Promise<TeamDto> {
    return this.teams.setMembers(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('team.manage')
  @ApiOperation({ summary: 'Delete a team; its members stay in the workspace' })
  @ApiNoContentResponse()
  async remove(
    @Actor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.teams.remove(actor, id);
  }
}

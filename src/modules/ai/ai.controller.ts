import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  Actor,
  type RequestActor,
  RequirePermissions,
} from '../authorization/tenant.decorators.js';
import { AiUsageService } from './ai-usage.service.js';
import { AiCheckDto, AiStatusDto, AiUsageQueryDto, AiUsageSummaryDto } from './ai.dto.js';
import { AiService } from './ai.service.js';

@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly usage: AiUsageService,
  ) {}

  @Get('status')
  @RequirePermissions('agent.read')
  @ApiOperation({ summary: 'Whether AI is set up on this server, and which models it uses' })
  @ApiOkResponse({ type: AiStatusDto })
  status(): AiStatusDto {
    return this.ai.status;
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('agent.manage')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a tiny prompt to confirm the provider answers' })
  @ApiOkResponse({ type: AiCheckDto })
  async check(@Actor() actor: RequestActor): Promise<AiCheckDto> {
    const started = Date.now();
    const result = await this.ai.generate(
      { organizationId: actor.organizationId, feature: 'ai.check' },
      {
        messages: [{ role: 'user', parts: [{ kind: 'text', text: 'Reply with exactly: ready' }] }],
        maxOutputTokens: 200,
        temperature: 0,
      },
    );
    return { latencyMs: Date.now() - started, model: result.model, reply: result.text };
  }

  @Get('usage')
  @RequirePermissions('agent.read')
  @ApiOperation({ summary: 'AI requests and tokens over the last N days (default 30)' })
  @ApiOkResponse({ type: AiUsageSummaryDto })
  usageSummary(@Actor() actor: RequestActor, @Query() query: AiUsageQueryDto) {
    return this.usage.summary(actor.organizationId, query.days ?? 30);
  }
}

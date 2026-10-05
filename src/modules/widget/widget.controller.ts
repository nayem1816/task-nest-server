import {
  Body,
  type CanActivate,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AppException } from '../../common/http/app-exception.js';
import { Public } from '../auth/auth.decorators.js';
import { type VisitorClaims, VisitorTokenService } from './visitor-token.service.js';
import {
  SendWidgetMessageDto,
  StartWidgetSessionDto,
  WidgetMessageDto,
  WidgetSessionDto,
} from './widget.dto.js';
import { WidgetService } from './widget.service.js';

const MINUTE = 60_000;

type VisitorRequest = Request & { visitor?: VisitorClaims };

@Injectable()
class VisitorGuard implements CanActivate {
  constructor(private readonly tokens: VisitorTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<VisitorRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const visitor = token ? await this.tokens.verify(token) : null;
    if (!visitor) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'VISITOR_SESSION_INVALID',
        'This chat session has ended. Reload the page to start a new one.',
      );
    }
    req.visitor = visitor;
    return true;
  }
}

const Visitor = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<VisitorRequest>().visitor!,
);

/**
 * The website widget's API. Public: callers are anonymous visitors, identified
 * by the visitor token from `session` and limited to their own chat.
 */
@ApiTags('Website widget')
@Public()
@Controller('widget')
export class WidgetController {
  constructor(private readonly widget: WidgetService) {}

  @Post('session')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @ApiOperation({ summary: 'Start or resume a visitor session for a widget key' })
  @ApiCreatedResponse({ type: WidgetSessionDto })
  start(@Body() dto: StartWidgetSessionDto) {
    return this.widget.startSession(dto);
  }

  @Get('messages')
  @UseGuards(VisitorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "The visitor's current conversation" })
  @ApiOkResponse({ type: [WidgetMessageDto] })
  history(@Visitor() visitor: VisitorClaims) {
    return this.widget.history(visitor);
  }

  @Post('messages')
  @UseGuards(VisitorGuard)
  @Throttle({ default: { limit: 20, ttl: MINUTE } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send a message as the visitor' })
  @ApiCreatedResponse({ type: WidgetMessageDto })
  send(@Visitor() visitor: VisitorClaims, @Body() dto: SendWidgetMessageDto) {
    return this.widget.send(visitor, dto);
  }
}

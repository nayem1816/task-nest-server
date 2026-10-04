import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env.js';
import { toUserDto, UserDto } from '../users/user.dto.js';
import { UsersService } from '../users/users.service.js';
import { type AuthContext, CurrentAuth, Public } from './auth.decorators.js';
import { AuthErrors } from './auth.errors.js';
import { AuthService, type SignedIn } from './auth.service.js';
import {
  AuthResponseDto,
  ChangePasswordDto,
  EmailDto,
  LoginDto,
  ResetPasswordDto,
  SessionDto,
  SignupDto,
  TokenDto,
} from './dto/auth.dto.js';
import {
  CsrfHeaderGuard,
  readRefreshCookie,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from './refresh-cookie.js';
import { SessionService } from './session.service.js';

const MINUTE = 60_000;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
    config: ConfigService<Env, true>,
  ) {
    const env = config.get('NODE_ENV', { infer: true });
    this.secureCookies =
      config.get('COOKIE_SECURE', { infer: true }) ?? (env !== 'development' && env !== 'test');
  }

  @Public()
  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 10 * MINUTE } })
  @ApiOperation({
    summary: 'Create an account and sign in',
    description: 'Sends a verification email. The refresh token is set as an httpOnly cookie.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({ description: '`EMAIL_TAKEN`' })
  @ApiTooManyRequestsResponse({ description: '`RATE_LIMITED`' })
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    return this.respond(res, await this.auth.signup(dto, clientInfo(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: '`INVALID_CREDENTIALS`' })
  @ApiTooManyRequestsResponse({ description: '`RATE_LIMITED`' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    return this.respond(res, await this.auth.login(dto, clientInfo(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfHeaderGuard)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({
    summary: 'Get a new access token',
    description:
      'Rotates the refresh cookie. Requires the `x-tasknest-csrf` header. Presenting an ' +
      'already-used refresh token revokes the whole session.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: '`SESSION_EXPIRED` or `SESSION_REVOKED`' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const token = readRefreshCookie(req);
    if (!token) throw AuthErrors.sessionExpired();
    try {
      return this.respond(res, await this.auth.refresh(token));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(this.secureCookies));
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CsrfHeaderGuard)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({ summary: 'Sign out of this browser' })
  @ApiNoContentResponse()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = readRefreshCookie(req);
    const sessionId = token && (await this.sessions.findSessionIdByRefreshToken(token));
    if (sessionId) await this.auth.logout(sessionId);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(this.secureCookies));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiOkResponse({ type: UserDto })
  async me(@CurrentAuth() auth: AuthContext): Promise<UserDto> {
    const user = await this.users.findById(auth.userId);
    if (!user) throw AuthErrors.sessionExpired();
    return toUserDto(user);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Browsers and devices currently signed in to this account' })
  @ApiOkResponse({ type: [SessionDto] })
  async listSessions(@CurrentAuth() auth: AuthContext): Promise<SessionDto[]> {
    const sessions = await this.sessions.listActive(auth.userId);
    return sessions.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: s.id === auth.sessionId,
    }));
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out a specific browser or device' })
  @ApiNoContentResponse()
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const revoked = await this.sessions.revokeOwned(auth.userId, id, 'revoked_by_user');
    if (!revoked) throw new NotFoundException('Session not found');
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  @ApiOperation({ summary: 'Confirm an email address with the emailed token' })
  @ApiNoContentResponse()
  async verifyEmail(@Body() dto: TokenDto): Promise<void> {
    await this.auth.verifyEmail(dto.token);
  }

  @Post('email/verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 15 * MINUTE } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send the verification email again' })
  @ApiAcceptedResponse()
  async resendVerification(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.auth.resendVerification(auth.userId);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 15 * MINUTE } })
  @ApiOperation({
    summary: 'Email a password reset link',
    description: 'Always returns 202, whether or not the email has an account.',
  })
  @ApiAcceptedResponse()
  async forgotPassword(@Body() dto: EmailDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  @ApiOperation({ summary: 'Set a new password with the emailed token; signs out everywhere' })
  @ApiNoContentResponse()
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 15 * MINUTE } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password; signs out every other session' })
  @ApiNoContentResponse()
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(auth.userId, auth.sessionId, dto);
  }

  private respond(res: Response, signedIn: SignedIn): AuthResponseDto {
    res.cookie(
      REFRESH_COOKIE,
      signedIn.refreshToken,
      refreshCookieOptions(this.secureCookies, signedIn.refreshExpiresAt),
    );
    res.setHeader('Cache-Control', 'no-store');
    return signedIn.response;
  }
}

function clientInfo(req: Request) {
  return { ip: req.clientIp ?? req.ip, userAgent: req.headers['user-agent'] };
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env.js';
import { Prisma, type User } from '../../generated/prisma/client.js';
import { AccountTokenPurpose, UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { MailService } from '../../infrastructure/mail/mail.service.js';
import { toUserDto } from '../users/user.dto.js';
import { UsersService } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import { AccountTokenService } from './account-token.service.js';
import { passwordResetEmail, verificationEmail } from './auth-emails.js';
import { AuthErrors } from './auth.errors.js';
import type { AuthResponseDto, ChangePasswordDto, LoginDto, SignupDto } from './dto/auth.dto.js';
import { PasswordService } from './password.service.js';
import { type ClientInfo, SessionService } from './session.service.js';

export interface SignedIn {
  response: AuthResponseDto;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly accessTokens: AccessTokenService,
    private readonly accountTokens: AccountTokenService,
    private readonly mail: MailService,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(AuthService.name);
    this.appUrl = config.get('APP_URL', { infer: true });
  }

  async signup(dto: SignupDto, client: ClientInfo): Promise<SignedIn> {
    const passwordHash = await this.passwords.hash(dto.password);

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: { name: dto.name, email: dto.email, passwordHash },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AuthErrors.emailTaken();
      }
      throw err;
    }

    // The account exists at this point; failing the signup because the mail
    // queue is down would leave the user unable to sign up or sign in. They can
    // ask for the email again from the app.
    await this.sendVerificationEmail(user).catch((err: unknown) =>
      this.logger.error({ err, userId: user.id }, 'Could not queue verification email'),
    );
    return this.signIn(user, client);
  }

  async login(dto: LoginDto, client: ClientInfo): Promise<SignedIn> {
    const user = await this.users.findByEmail(dto.email);
    // Always run the hash check, even for unknown emails, so response time
    // does not reveal which addresses have accounts.
    const valid = await this.passwords.verify(user?.passwordHash, dto.password);
    if (!user || !valid) throw AuthErrors.invalidCredentials();
    if (user.status === UserStatus.DISABLED) throw AuthErrors.accountDisabled();

    await this.users.recordLogin(user.id);
    return this.signIn(user, client);
  }

  async refresh(refreshToken: string): Promise<SignedIn> {
    const { session, refreshToken: next } = await this.sessions.rotate(refreshToken);
    const user = await this.users.findById(session.userId);
    if (!user || user.status === UserStatus.DISABLED) {
      await this.sessions.revoke(session.id, 'user_unavailable');
      throw AuthErrors.sessionExpired();
    }
    return this.buildSignedIn(user, session.id, next, session.expiresAt);
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, 'logout');
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.accountTokens.consume(token, AccountTokenPurpose.EMAIL_VERIFICATION);
    if (!userId) throw AuthErrors.invalidAccountToken();
    await this.users.markEmailVerified(userId);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.emailVerifiedAt) return;
    await this.sendVerificationEmail(user);
  }

  /** Silent when the email is unknown, so the endpoint cannot be used to probe for accounts. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status === UserStatus.DISABLED) return;

    const { id, token } = await this.accountTokens.issue(
      user.id,
      AccountTokenPurpose.PASSWORD_RESET,
    );
    await this.mail.send(
      'password_reset',
      passwordResetEmail({
        to: user.email,
        name: user.name,
        link: this.link('/reset-password', token),
      }),
      `password-reset-${id}`,
    );
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.accountTokens.consume(token, AccountTokenPurpose.PASSWORD_RESET);
    if (!userId) throw AuthErrors.invalidAccountToken();

    const passwordHash = await this.passwords.hash(password);
    // Receiving the reset email proves ownership of the inbox.
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, emailVerifiedAt: { set: new Date() } },
    });
    await this.sessions.revokeAllForUser(userId, 'password_reset');
    this.logger.info({ userId }, 'Password reset; all sessions revoked');
  }

  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || !(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw AuthErrors.wrongCurrentPassword();
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.sessions.revokeAllForUser(userId, 'password_changed', sessionId);
  }

  private async signIn(user: User, client: ClientInfo): Promise<SignedIn> {
    const { session, refreshToken } = await this.sessions.create(user.id, client);
    return this.buildSignedIn(user, session.id, refreshToken, session.expiresAt);
  }

  private async buildSignedIn(
    user: User,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<SignedIn> {
    const accessToken = await this.accessTokens.sign({ userId: user.id, sessionId });
    return {
      response: { accessToken, expiresIn: this.accessTokens.ttlSeconds, user: toUserDto(user) },
      refreshToken,
      refreshExpiresAt,
    };
  }

  private async sendVerificationEmail(user: User): Promise<void> {
    const { id, token } = await this.accountTokens.issue(
      user.id,
      AccountTokenPurpose.EMAIL_VERIFICATION,
    );
    await this.mail.send(
      'email_verification',
      verificationEmail({
        to: user.email,
        name: user.name,
        link: this.link('/verify-email', token),
      }),
      `email-verification-${id}`,
    );
  }

  private link(path: string, token: string): string {
    const url = new URL(path, this.appUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
}

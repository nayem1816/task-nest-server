import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { AccessEvents, type SessionsRevokedEvent } from '../../common/events/access.events.js';
import { generateOpaqueToken, hashOpaqueToken } from '../../common/crypto/opaque-token.js';
import type { Env } from '../../config/env.js';
import type { Session } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { REDIS } from '../../infrastructure/redis/redis.module.js';
import { AuthErrors } from './auth.errors.js';

/**
 * Two tabs refreshing at the same moment both present the same token. Inside
 * this window a second use is treated as that race, not as theft.
 */
const REUSE_GRACE_MS = 10_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  session: Session;
  refreshToken: string;
}

@Injectable()
export class SessionService {
  private readonly sessionTtlMs: number;
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
    private readonly events: EventEmitter2,
    config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(SessionService.name);
    this.sessionTtlMs = config.get('SESSION_TTL_DAYS', { infer: true }) * DAY_MS;
    this.accessTtlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  }

  async create(userId: string, client: ClientInfo): Promise<IssuedSession> {
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);

    const session = await this.prisma.session.create({
      data: {
        userId,
        ip: client.ip,
        userAgent: client.userAgent?.slice(0, 512),
        expiresAt,
        refreshTokens: { create: { tokenHash: hashOpaqueToken(refreshToken), expiresAt } },
      },
    });
    return { session, refreshToken };
  }

  /** Exchanges a refresh token for a new one. Every token works exactly once. */
  async rotate(refreshToken: string): Promise<IssuedSession> {
    const now = new Date();
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashOpaqueToken(refreshToken) },
      include: { session: true },
    });

    if (!record || record.session.revokedAt || record.session.expiresAt <= now) {
      throw AuthErrors.sessionExpired();
    }
    const { session } = record;

    if (record.usedAt) {
      if (now.getTime() - record.usedAt.getTime() < REUSE_GRACE_MS) {
        throw AuthErrors.refreshInProgress();
      }
      await this.revoke(session.id, 'refresh_token_reuse');
      this.logger.warn(
        { sessionId: session.id, userId: session.userId },
        'Refresh token reused after rotation; session revoked',
      );
      throw AuthErrors.refreshTokenReused();
    }

    const next = generateOpaqueToken();
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Conditional update: of two concurrent requests, only one claims the token.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) return null;

      await tx.refreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: hashOpaqueToken(next),
          expiresAt: session.expiresAt,
        },
      });
      return tx.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
    });

    if (!rotated) throw AuthErrors.refreshInProgress();
    return { session: rotated, refreshToken: next };
  }

  async findSessionIdByRefreshToken(refreshToken: string): Promise<string | null> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashOpaqueToken(refreshToken) },
      select: { sessionId: true },
    });
    return record?.sessionId ?? null;
  }

  async findActive(sessionId: string): Promise<Session | null> {
    return this.prisma.session.findFirst({
      where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  listActive(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  /** Revokes only if the session belongs to the user; returns whether it did. */
  async revokeOwned(userId: string, sessionId: string, reason: string): Promise<boolean> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
      select: { id: true },
    });
    if (!session) return false;
    await this.revoke(session.id, reason);
    return true;
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    await this.markAccessRevoked([sessionId]);
  }

  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, ...(exceptSessionId && { id: { not: exceptSessionId } }) },
      select: { id: true },
    });
    if (sessions.length === 0) return;

    const ids = sessions.map((s) => s.id);
    await this.prisma.session.updateMany({
      where: { id: { in: ids } },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    await this.markAccessRevoked(ids);
  }

  /**
   * Access tokens are stateless, so revoking a session in Postgres alone would
   * leave its access token valid until expiry. The guard checks this Redis key;
   * it only needs to live as long as an access token can.
   */
  async isAccessRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(revokedKey(sessionId))) === 1;
  }

  private async markAccessRevoked(sessionIds: string[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const id of sessionIds) pipeline.set(revokedKey(id), '1', 'EX', this.accessTtlSeconds);
    await pipeline.exec();
    this.events.emit(AccessEvents.sessionsRevoked, { sessionIds } satisfies SessionsRevokedEvent);
  }
}

function revokedKey(sessionId: string): string {
  return `tasknest:revoked-session:${sessionId}`;
}

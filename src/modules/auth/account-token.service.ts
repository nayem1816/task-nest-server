import { Injectable } from '@nestjs/common';
import { generateOpaqueToken, hashOpaqueToken } from '../../common/crypto/opaque-token.js';
import { AccountTokenPurpose } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

const TTL_MS: Record<AccountTokenPurpose, number> = {
  [AccountTokenPurpose.EMAIL_VERIFICATION]: 48 * 60 * 60 * 1000,
  [AccountTokenPurpose.PASSWORD_RESET]: 60 * 60 * 1000,
};

/** Single-use tokens delivered by email: verification and password reset links. */
@Injectable()
export class AccountTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Issuing a new token invalidates any earlier unused one for the same purpose. */
  async issue(
    userId: string,
    purpose: AccountTokenPurpose,
  ): Promise<{ id: string; token: string }> {
    const token = generateOpaqueToken();
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.accountToken.deleteMany({ where: { userId, purpose, usedAt: null } });
      return tx.accountToken.create({
        data: {
          userId,
          purpose,
          tokenHash: hashOpaqueToken(token),
          expiresAt: new Date(Date.now() + TTL_MS[purpose]),
        },
      });
    });
    return { id: record.id, token };
  }

  /** Returns the user id if the token is valid, and marks it used in the same step. */
  async consume(token: string, purpose: AccountTokenPurpose): Promise<string | null> {
    const tokenHash = hashOpaqueToken(token);
    const now = new Date();
    const record = await this.prisma.accountToken.findUnique({ where: { tokenHash } });
    if (!record || record.purpose !== purpose) return null;

    const claimed = await this.prisma.accountToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return claimed.count === 1 ? record.userId : null;
  }
}

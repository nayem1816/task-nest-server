import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AiUsageSummaryDto, AiUsageTotalsDto } from './ai.dto.js';

interface Row {
  key: string;
  requests: bigint;
  failed: bigint;
  inputTokens: bigint | null;
  outputTokens: bigint | null;
}

@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(organizationId: string, days: number): Promise<AiUsageSummaryDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [byFeature, byDay] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT "feature" AS key,
               count(*) AS requests,
               count(*) FILTER (WHERE NOT "ok") AS failed,
               sum("inputTokens") AS "inputTokens",
               sum("outputTokens") AS "outputTokens"
        FROM "AiUsage"
        WHERE "organizationId" = ${organizationId}::uuid AND "createdAt" >= ${since}
        GROUP BY "feature"
        ORDER BY requests DESC`,
      this.prisma.$queryRaw<Row[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${org.timezone}, 'YYYY-MM-DD') AS key,
               count(*) AS requests,
               count(*) FILTER (WHERE NOT "ok") AS failed,
               sum("inputTokens") AS "inputTokens",
               sum("outputTokens") AS "outputTokens"
        FROM "AiUsage"
        WHERE "organizationId" = ${organizationId}::uuid AND "createdAt" >= ${since}
        GROUP BY key
        ORDER BY key`,
    ]);

    const features = byFeature.map((r) => ({ feature: r.key, ...totals(r) }));
    return {
      days,
      totals: features.reduce<AiUsageTotalsDto>(
        (sum, f) => ({
          requests: sum.requests + f.requests,
          failed: sum.failed + f.failed,
          inputTokens: sum.inputTokens + f.inputTokens,
          outputTokens: sum.outputTokens + f.outputTokens,
        }),
        { requests: 0, failed: 0, inputTokens: 0, outputTokens: 0 },
      ),
      byFeature: features,
      byDay: byDay.map((r) => ({ date: r.key, ...totals(r) })),
    };
  }
}

function totals(row: Row): AiUsageTotalsDto {
  return {
    requests: Number(row.requests),
    failed: Number(row.failed),
    inputTokens: Number(row.inputTokens ?? 0),
    outputTokens: Number(row.outputTokens ?? 0),
  };
}

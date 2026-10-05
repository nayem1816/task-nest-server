import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AiService } from '../ai/ai.service.js';
import type { KnowledgeSearchResultDto } from './knowledge.dto.js';

// Each half of the hybrid search contributes this many candidates.
const CANDIDATES = 30;
// Reciprocal rank fusion constant; 60 is the usual choice and keeps one
// list's top hit from drowning out agreement between both lists.
const RRF_K = 60;

/**
 * Hybrid search: semantic (embedding distance) finds passages that mean the
 * same thing in other words; keyword (full text) catches exact names, SKUs and
 * order numbers that embeddings blur. Results are merged by reciprocal rank.
 */
@Injectable()
export class KnowledgeSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async search(
    organizationId: string,
    query: string,
    limit: number,
    feature = 'knowledge.search',
  ): Promise<KnowledgeSearchResultDto[]> {
    const [vector] = await this.ai.embed({ organizationId, feature }, [query], 'query');
    const embedding = `[${vector!.join(',')}]`;
    const terms = keywordQuery(query);

    return this.prisma.$transaction(async (tx) => {
      // Filtering by workspace after the HNSW scan could leave fewer than
      // CANDIDATES rows; iterative scan keeps reading until it has enough.
      await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = relaxed_order`;
      return tx.$queryRaw<KnowledgeSearchResultDto[]>`
        WITH semantic AS (
          SELECT c."id", row_number() OVER (ORDER BY c."embedding" <=> ${embedding}::vector) AS rank
          FROM "KnowledgeChunk" c
          JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
          WHERE c."organizationId" = ${organizationId}::uuid
            AND s."status" <> 'FAILED' AND c."embedding" IS NOT NULL
          ORDER BY c."embedding" <=> ${embedding}::vector
          LIMIT ${CANDIDATES}
        ),
        keyword AS (
          SELECT c."id", row_number() OVER (ORDER BY ts_rank(c."search", q) DESC) AS rank
          FROM "KnowledgeChunk" c
          JOIN "KnowledgeSource" s ON s."id" = c."sourceId",
               to_tsquery('simple', ${terms}) q
          WHERE ${terms} <> '' AND c."organizationId" = ${organizationId}::uuid
            AND s."status" <> 'FAILED' AND c."search" @@ q
          ORDER BY ts_rank(c."search", q) DESC
          LIMIT ${CANDIDATES}
        )
        SELECT c."id" AS "chunkId", c."sourceId", s."title" AS "sourceTitle",
               s."type"::text AS "sourceType", s."url", c."heading", c."content",
               (1 - (c."embedding" <=> ${embedding}::vector))::float8 AS "similarity",
               (coalesce(1.0 / (${RRF_K} + sem.rank), 0) + coalesce(1.0 / (${RRF_K} + kw.rank), 0))::float8 AS "score"
        FROM (SELECT "id" FROM semantic UNION SELECT "id" FROM keyword) hits
        JOIN "KnowledgeChunk" c ON c."id" = hits."id"
        JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
        LEFT JOIN semantic sem ON sem."id" = c."id"
        LEFT JOIN keyword kw ON kw."id" = c."id"
        ORDER BY "score" DESC
        LIMIT ${limit}`;
    });
  }
}

/** "Do you ship to Canada?" → "do | you | ship | to | canada": any word may match. */
export function keywordQuery(query: string): string {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, 16).join(' | ');
}

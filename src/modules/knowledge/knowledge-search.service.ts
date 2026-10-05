import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AiService } from '../ai/ai.service.js';
import type { KnowledgeSearchResultDto } from './knowledge.dto.js';

// Each half of the hybrid search contributes this many candidates.
const CANDIDATES = 30;
// Added to a passage's similarity when it also matches the words of the
// question: the best keyword match gets the full bonus, the next half, and so
// on. Small on purpose. Rank fusion was tried first and let a passage that
// merely shared a word outrank a clearly closer one, because it ignores how
// close the semantic matches actually are.
const KEYWORD_BONUS = 0.05;

/**
 * Hybrid search: semantic (embedding distance) finds passages that mean the
 * same thing in other words; keyword (full text) catches exact names, SKUs and
 * order numbers that embeddings blur. Results are ordered by similarity, with
 * a small bonus for keyword matches.
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
               ((1 - (c."embedding" <=> ${embedding}::vector)) + coalesce(${KEYWORD_BONUS}::float8 / kw.rank, 0))::float8 AS "score"
        FROM (SELECT "id" FROM semantic UNION SELECT "id" FROM keyword) hits
        JOIN "KnowledgeChunk" c ON c."id" = hits."id"
        JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
        LEFT JOIN keyword kw ON kw."id" = c."id"
        ORDER BY "score" DESC
        LIMIT ${limit}`;
    });
  }
}

// Words that appear in almost every passage. Left in, they would give every
// passage containing "can" or "you" a keyword hit, and that boost is enough to
// push the passage that actually answers the question out of the results.
const STOP_WORDS = new Set(
  (
    'a an and are as at be been but by can could did do does for from had has have how i if in ' +
    'into is it its me my no not of on or our please so that the their them then there these ' +
    'they this to too us was we were what when where which who why will with would you your'
  ).split(' '),
);

/**
 * "Where can I park?" → "park:*". Common words are dropped, and longer words
 * match as prefixes, so "park" finds "parking" without a language-specific
 * stemmer (which would mangle product names and non-English text).
 */
export function keywordQuery(query: string): string {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return [...new Set(words)]
    .slice(0, 16)
    .map((w) => (w.length >= 4 ? `${w}:*` : w))
    .join(' | ');
}

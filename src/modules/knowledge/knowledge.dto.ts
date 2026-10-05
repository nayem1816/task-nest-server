import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUrl, Length, Max, MaxLength, Min } from 'class-validator';
import { KnowledgeSourceStatus, KnowledgeSourceType } from '../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class KnowledgeSourceDto {
  id!: string;
  type!: KnowledgeSourceType;
  title!: string;
  url!: string | null;
  fileName!: string | null;
  status!: KnowledgeSourceStatus;
  /** Why the last indexing failed, in words for the person who added it. */
  error!: string | null;
  chunkCount!: number;
  charCount!: number;
  lastIndexedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class KnowledgeChunkPreviewDto {
  position!: number;
  heading!: string | null;
  content!: string;
}

export class KnowledgeSourceDetailDto extends KnowledgeSourceDto {
  /** The text the AI learns from: what was written, or what was read from the page or file. */
  content!: string | null;
  chunks!: KnowledgeChunkPreviewDto[];
}

export class CreateTextSourceDto {
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  title!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 300_000)
  content!: string;
}

export class CreateUrlSourceDto {
  @Transform(trim)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'url must start with https:// or http://' },
  )
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Length(1, 160)
  title?: string;
}

export class CreateFileSourceDto {
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Length(1, 160)
  title?: string;
}

export class UpdateSourceDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  title?: string;

  /** Written sources only. Changing it re-indexes the source. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 300_000)
  content?: string;
}

export class KnowledgeSearchDto {
  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class KnowledgeSearchResultDto {
  chunkId!: string;
  sourceId!: string;
  sourceTitle!: string;
  sourceType!: string;
  url!: string | null;
  heading!: string | null;
  content!: string;
  /** Cosine similarity, 0 to 1. Below ~0.5 the passage is probably not about the question. */
  similarity!: number;
  /** Similarity plus a small keyword-match bonus; the order results come in. */
  score!: number;
}

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class AiStatusDto {
  configured!: boolean;
  /** Null when not configured. */
  provider!: string | null;
  chatModel!: string;
  embeddingModel!: string;
}

export class AiCheckDto {
  latencyMs!: number;
  model!: string;
  /** What the model answered to the test prompt. */
  reply!: string;
}

export class AiUsageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}

export class AiUsageTotalsDto {
  requests!: number;
  failed!: number;
  inputTokens!: number;
  outputTokens!: number;
}

export class AiUsageByFeatureDto extends AiUsageTotalsDto {
  feature!: string;
}

export class AiUsageByDayDto extends AiUsageTotalsDto {
  /** YYYY-MM-DD in the workspace's time zone. */
  date!: string;
}

export class AiUsageSummaryDto {
  days!: number;
  totals!: AiUsageTotalsDto;
  byFeature!: AiUsageByFeatureDto[];
  byDay!: AiUsageByDayDto[];
}

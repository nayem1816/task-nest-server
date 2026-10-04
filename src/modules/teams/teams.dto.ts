import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTeamDto {
  /** @example "Customer Care" */
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;

  /** @example "Orders, shipping, subscriptions and returns." */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(240)
  description?: string;
}

export class UpdateTeamDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(240)
  description?: string;
}

export class SetTeamMembersDto {
  /** The full list of member ids; anyone not listed is removed from the team. */
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  memberIds!: string[];
}

export class TeamMemberRefDto {
  id!: string;
  name!: string;
}

export class TeamDto {
  id!: string;
  name!: string;
  description!: string | null;
  members!: TeamMemberRefDto[];
  createdAt!: Date;
}

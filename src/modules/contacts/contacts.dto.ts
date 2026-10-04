import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ChannelType, LifecycleStage } from '../../generated/prisma/enums.js';

/** Trims strings and turns "" into null, so clearing a field in a form clears it here. */
const blankToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export const TAG_COLORS = [
  'slate',
  'blue',
  'green',
  'amber',
  'red',
  'violet',
  'teal',
  'pink',
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export class ContactFieldsDto {
  /** @example "Sarah Mitchell" */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @Length(1, 120)
  name?: string | null;

  /** @example "sarah.mitchell@gmail.com" */
  @IsOptional()
  @Transform(blankToNull)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  /** Any format people type; stored as entered. @example "+1 512 555 0143" */
  @IsOptional()
  @Transform(blankToNull)
  @Matches(/^[+\d][\d\s().-]{5,24}$/, { message: 'phone must look like a phone number' })
  phone?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(120)
  company?: string | null;

  /** @example "Austin, TX" */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(120)
  location?: string | null;

  @IsOptional()
  @IsEnum(LifecycleStage)
  stage?: LifecycleStage;
}

export class CreateContactDto extends ContactFieldsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  tagIds?: string[];
}

export class UpdateContactDto extends ContactFieldsDto {}

export class SetContactTagsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  tagIds!: string[];
}

export class ListContactsQueryDto {
  /** Matches name, email, phone or company. */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(LifecycleStage)
  stage?: LifecycleStage;

  @IsOptional()
  @IsUUID()
  tagId?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class PageQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;
}

export class TagDto {
  id!: string;
  name!: string;
  color!: string;
}

export class ContactIdentityDto {
  channel!: ChannelType;
  externalId!: string;
}

export class ContactDto {
  id!: string;
  /** Name, or email, or phone: whatever identifies the contact best. */
  displayName!: string;
  name!: string | null;
  email!: string | null;
  phone!: string | null;
  company!: string | null;
  location!: string | null;
  stage!: LifecycleStage;
  lastSeenAt!: Date | null;
  createdAt!: Date;
  tags!: TagDto[];
}

export class ContactDetailDto extends ContactDto {
  identities!: ContactIdentityDto[];
  noteCount!: number;
}

export class ContactPageDto {
  data!: ContactDto[];
  nextCursor!: string | null;
}

export class CreateTagDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 40)
  name!: string;

  @IsOptional()
  @IsIn(TAG_COLORS)
  color?: TagColor;
}

export class UpdateTagDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 40)
  name?: string;

  @IsOptional()
  @IsIn(TAG_COLORS)
  color?: TagColor;
}

export class TagWithUsageDto extends TagDto {
  contactCount!: number;
}

export class CreateNoteDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 5000)
  body!: string;
}

export class NoteDto {
  id!: string;
  body!: string;
  author!: { id: string; name: string } | null;
  createdAt!: Date;
}

export class NotePageDto {
  data!: NoteDto[];
  nextCursor!: string | null;
}

export class ActivityDto {
  id!: string;
  type!: string;
  actorLabel!: string | null;
  metadata!: Record<string, unknown> | null;
  createdAt!: Date;
}

export class ActivityPageDto {
  data!: ActivityDto[];
  nextCursor!: string | null;
}

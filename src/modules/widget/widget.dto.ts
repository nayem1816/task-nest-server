import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class StartWidgetSessionDto {
  /** The channel's public key from the install snippet. */
  @IsString()
  @Matches(/^wk_[\w-]{10,40}$/, { message: 'key is not a widget key' })
  key!: string;

  /** A token from an earlier visit, to continue that visitor's chat. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  visitorToken?: string;

  /** Origin of the page the widget is on, checked against the channel's allowed sites. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pageOrigin?: string;
}

export class WidgetConfigDto {
  workspaceName!: string;
  greeting!: string;
  accentColor!: string;
  askForEmail!: boolean;
}

export class WidgetVisitorDto {
  name!: string | null;
  email!: string | null;
}

export class WidgetSessionDto {
  visitorToken!: string;
  config!: WidgetConfigDto;
  visitor!: WidgetVisitorDto;
}

export class WidgetMessageDto {
  id!: string;
  from!: 'visitor' | 'team' | 'assistant';
  /** First name of the teammate who replied; null for the visitor's own messages. */
  authorName!: string | null;
  body!: string;
  createdAt!: Date;
}

export class SendWidgetMessageDto {
  @Transform(trim)
  @IsString()
  @Length(1, 5000)
  body!: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

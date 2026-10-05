import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { ChannelStatus, ChannelType } from '../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class WebChatSettingsDto {
  greeting!: string;
  /** Hex color of the launcher and the visitor's messages. */
  accentColor!: string;
  /** Sites allowed to load the widget. Empty means any site. */
  allowedOrigins!: string[];
  askForEmail!: boolean;
}

export class ChannelDto {
  id!: string;
  type!: ChannelType;
  name!: string;
  status!: ChannelStatus;
  /** Website chat only: the key the install snippet uses. */
  publicKey!: string | null;
  /** Website chat only. */
  webChat!: WebChatSettingsDto | null;
  openConversations!: number;
  createdAt!: Date;
}

export class CreateWebsiteChannelDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;
}

export class UpdateChannelDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name?: string;

  /** Turning a channel off stops new conversations; existing ones stay readable. */
  @IsOptional()
  @IsIn([ChannelStatus.ACTIVE, ChannelStatus.DISCONNECTED])
  status?: ChannelStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(280)
  greeting?: string;

  @IsOptional()
  @Matches(/^#[0-9a-f]{6}$/i, { message: 'accentColor must be a hex color like #2563eb' })
  accentColor?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  allowedOrigins?: string[];

  @IsOptional()
  @IsBoolean()
  askForEmail?: boolean;
}

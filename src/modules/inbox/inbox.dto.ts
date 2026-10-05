import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ChannelType,
  ConversationHandler,
  ConversationPriority,
  ConversationStatus,
  LifecycleStage,
  MessageSender,
} from '../../generated/prisma/enums.js';
import { TagDto } from '../contacts/contacts.dto.js';

const blankToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const INBOX_VIEWS = ['all', 'mine', 'unassigned', 'team'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export class ListConversationsQueryDto {
  /** Whose conversations: everyone's, yours, nobody's, or your teams'. */
  @IsOptional()
  @IsIn(INBOX_VIEWS)
  view: InboxView = 'all';

  /** "open" means OPEN or PENDING. */
  @IsOptional()
  @IsIn(['open', 'all', ...Object.values(ConversationStatus)])
  status: 'open' | 'all' | ConversationStatus = 'open';

  @IsOptional()
  @IsEnum(ConversationHandler)
  handler?: ConversationHandler;

  /** "high" matches HIGH and URGENT. */
  @IsOptional()
  @IsIn(['high'])
  priority?: 'high';

  /** Filter by the contact's lifecycle stage (leads, customers). */
  @IsOptional()
  @IsEnum(LifecycleStage)
  stage?: LifecycleStage;

  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsUUID()
  tagId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  /** Only conversations with customer messages you have not read. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  unread?: boolean;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(100)
  search?: string;

  /** `nextCursor` from the previous page. Opaque. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;
}

export class AssignConversationDto {
  /** Member id, or null to unassign. */
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assigneeId!: string | null;

  /** Team id, or null to clear. Omit to leave the team unchanged. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  teamId?: string | null;
}

export class UpdateConversationDto {
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @IsOptional()
  @IsEnum(ConversationPriority)
  priority?: ConversationPriority;
}

export class SetConversationTagsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  tagIds!: string[];
}

export class SendMessageDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 10_000)
  body!: string;

  /** An internal note: visible to the team, never sent to the customer. */
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}

export class MessagesQueryDto {
  /** Load messages older than this message id. */
  @IsOptional()
  @IsUUID()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class ChannelRefDto {
  id!: string;
  type!: ChannelType;
  name!: string;
}

export class ConversationContactDto {
  id!: string;
  displayName!: string;
  email!: string | null;
  stage!: LifecycleStage;
}

export class MemberRefDto {
  id!: string;
  name!: string;
}

export class TeamRefDto {
  id!: string;
  name!: string;
}

export class ConversationDto {
  id!: string;
  subject!: string | null;
  status!: ConversationStatus;
  handler!: ConversationHandler;
  priority!: ConversationPriority;
  escalationReason!: string | null;
  channel!: ChannelRefDto;
  contact!: ConversationContactDto;
  assignee!: MemberRefDto | null;
  team!: TeamRefDto | null;
  tags!: TagDto[];
  lastMessageAt!: Date;
  lastMessagePreview!: string | null;
  /** Customer messages you have not read yet. */
  unreadCount!: number;
  createdAt!: Date;
}

export class ConversationPageDto {
  data!: ConversationDto[];
  nextCursor!: string | null;
}

export class InboxCountsDto {
  /** Open or pending, in each view. */
  all!: number;
  mine!: number;
  unassigned!: number;
  team!: number;
}

export class MessageDto {
  id!: string;
  conversationId!: string;
  sender!: MessageSender;
  internal!: boolean;
  body!: string;
  author!: MemberRefDto | null;
  metadata!: Record<string, unknown> | null;
  createdAt!: Date;
}

export class MessagePageDto {
  /** Oldest first, ready to render top to bottom. */
  data!: MessageDto[];
  /** Pass as `before` to load the page above, or null at the start of the conversation. */
  nextBefore!: string | null;
}

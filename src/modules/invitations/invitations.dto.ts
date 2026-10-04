import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { RoleRefDto } from '../members/members.dto.js';

export class CreateInvitationDto {
  /** @example "tom@northstarcoffee.co" */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsUUID()
  roleId!: string;
}

export class InvitationTokenDto {
  @IsString()
  @Length(20, 100)
  token!: string;
}

export class InvitationDto {
  id!: string;
  email!: string;
  role!: RoleRefDto;
  invitedBy!: string | null;
  expiresAt!: Date;
  createdAt!: Date;
}

/** What someone sees before accepting: enough to recognise the invitation, nothing more. */
export class InvitationPreviewDto {
  organizationName!: string;
  invitedBy!: string | null;
  email!: string;
  roleName!: string;
  expiresAt!: Date;
}

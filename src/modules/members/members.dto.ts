import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { MemberStatus } from '../../generated/prisma/enums.js';

export class UpdateMemberDto {
  @IsOptional()
  @IsUUID()
  roleId?: string;

  /** Disabled members keep their history but cannot open the workspace. */
  @IsOptional()
  @IsEnum(MemberStatus)
  status?: MemberStatus;
}

export class MemberUserDto {
  id!: string;
  name!: string;
  email!: string;
  avatarUrl!: string | null;
}

export class RoleRefDto {
  id!: string;
  key!: string;
  name!: string;
}

export class TeamRefDto {
  id!: string;
  name!: string;
}

export class MemberDto {
  id!: string;
  status!: MemberStatus;
  displayName!: string | null;
  joinedAt!: Date;
  user!: MemberUserDto;
  role!: RoleRefDto;
  teams!: TeamRefDto[];
}

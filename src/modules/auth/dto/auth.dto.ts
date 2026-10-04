import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { UserDto } from '../../users/user.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export class SignupDto {
  /** @example "Maya Chen" */
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name!: string;

  /** @example "maya@northstarcoffee.co" */
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** At least 10 characters. Passphrases are welcome. */
  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  password!: string;
}

export class LoginDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(1, PASSWORD_MAX)
  password!: string;
}

export class EmailDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class TokenDto {
  /** The token from the emailed link. */
  @IsString()
  @Length(20, 100)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(1, PASSWORD_MAX)
  currentPassword!: string;

  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  newPassword!: string;
}

export class AuthResponseDto {
  /** Short-lived bearer token. Keep it in memory, not in storage. */
  accessToken!: string;
  /** Seconds until `accessToken` expires. */
  expiresIn!: number;
  user!: UserDto;
}

export class SessionDto {
  id!: string;
  ip!: string | null;
  userAgent!: string | null;
  createdAt!: Date;
  lastUsedAt!: Date;
  /** True for the session that made this request. */
  current!: boolean;
}

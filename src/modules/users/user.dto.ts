import type { User } from '../../generated/prisma/client.js';

export class UserDto {
  id!: string;
  email!: string;
  name!: string;
  emailVerified!: boolean;
  avatarUrl!: string | null;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    avatarUrl: user.avatarUrl,
  };
}

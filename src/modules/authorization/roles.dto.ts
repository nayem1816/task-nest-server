export class RoleDto {
  id!: string;
  key!: string;
  name!: string;
  description!: string | null;
  isSystem!: boolean;
  permissions!: string[];
  memberCount!: number;
}

export class PermissionDto {
  /** @example "conversation.reply" */
  key!: string;
  description!: string;
}

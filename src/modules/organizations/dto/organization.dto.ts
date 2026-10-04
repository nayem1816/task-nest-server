import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsTimeZone, Length } from 'class-validator';

export const BUSINESS_TYPES = [
  'ecommerce',
  'd2c',
  'saas',
  'services',
  'agency',
  'education',
  'clinic',
  'other',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateOrganizationDto {
  /** @example "Northstar Coffee" */
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name!: string;

  @IsOptional()
  @IsIn(BUSINESS_TYPES)
  businessType?: BusinessType;

  /** IANA time zone used for business hours and reports. @example "America/Chicago" */
  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsIn(BUSINESS_TYPES)
  businessType?: BusinessType;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}

export class MembershipRoleDto {
  key!: string;
  name!: string;
}

export class OrganizationDto {
  id!: string;
  name!: string;
  slug!: string;
  businessType!: string | null;
  timezone!: string;
  createdAt!: Date;
}

export class MyOrganizationDto extends OrganizationDto {
  /** Your role in this workspace. */
  role!: MembershipRoleDto;
  /** Permission keys your role grants, for showing or hiding UI. */
  permissions!: string[];
}

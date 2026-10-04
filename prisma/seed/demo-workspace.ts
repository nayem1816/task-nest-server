import { hash } from '@node-rs/argon2';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { ARGON2_OPTIONS } from '../../src/modules/auth/password.service.js';
import { SYSTEM_ROLES, type SystemRoleKey } from '../../src/modules/authorization/system-roles.js';

/**
 * Northstar Coffee: a small online roaster with a support team, a sales rep and
 * an ops lead. Later phases add customers, orders, conversations and knowledge
 * on top of this workspace, so names here are referenced elsewhere.
 */
const ORGANIZATION = {
  slug: 'northstar-coffee',
  name: 'Northstar Coffee',
  businessType: 'ecommerce',
  timezone: 'America/Chicago',
};

const PEOPLE: { email: string; name: string; role: SystemRoleKey; teams: string[] }[] = [
  { email: 'maya@northstarcoffee.co', name: 'Maya Chen', role: 'owner', teams: [] },
  { email: 'daniel@northstarcoffee.co', name: 'Daniel Okafor', role: 'admin', teams: [] },
  {
    email: 'priya@northstarcoffee.co',
    name: 'Priya Raman',
    role: 'manager',
    teams: ['Customer Care'],
  },
  {
    email: 'tom@northstarcoffee.co',
    name: 'Tom Becker',
    role: 'agent',
    teams: ['Customer Care'],
  },
  {
    email: 'lucia@northstarcoffee.co',
    name: 'Lucía Fernández',
    role: 'agent',
    teams: ['Customer Care', 'Wholesale'],
  },
  {
    email: 'sam@northstarcoffee.co',
    name: 'Sam Whitfield',
    role: 'sales',
    teams: ['Wholesale'],
  },
  { email: 'erin@northstarcoffee.co', name: 'Erin Walsh', role: 'viewer', teams: [] },
];

const TEAMS = [
  { name: 'Customer Care', description: 'Orders, shipping, subscriptions and returns.' },
  { name: 'Wholesale', description: 'Cafés and offices buying in bulk.' },
];

/** Shared by every demo user so the workspace can be explored from any role. */
export const DEMO_PASSWORD = 'northstar-demo';

/** Idempotent: safe to run against a database that already has the workspace. */
export async function seedDemoWorkspace(prisma: PrismaClient) {
  const passwordHash = await hash(DEMO_PASSWORD, ARGON2_OPTIONS);
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.upsert({
      where: { slug: ORGANIZATION.slug },
      update: {},
      create: ORGANIZATION,
    });

    const roleIds = new Map<SystemRoleKey, string>();
    for (const role of SYSTEM_ROLES) {
      const { id } = await tx.role.upsert({
        where: { organizationId_key: { organizationId: organization.id, key: role.key } },
        update: { permissions: [...role.permissions] },
        create: {
          organizationId: organization.id,
          key: role.key,
          name: role.name,
          description: role.description,
          permissions: [...role.permissions],
          isSystem: true,
        },
      });
      roleIds.set(role.key, id);
    }

    const teamIds = new Map<string, string>();
    for (const team of TEAMS) {
      const { id } = await tx.team.upsert({
        where: { organizationId_name: { organizationId: organization.id, name: team.name } },
        update: {},
        create: { ...team, organizationId: organization.id },
      });
      teamIds.set(team.name, id);
    }

    for (const person of PEOPLE) {
      const user = await tx.user.upsert({
        where: { email: person.email },
        update: { passwordHash },
        create: {
          email: person.email,
          name: person.name,
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      });

      const member = await tx.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
        update: {},
        create: {
          organizationId: organization.id,
          userId: user.id,
          roleId: roleIds.get(person.role)!,
        },
      });

      for (const teamName of person.teams) {
        await tx.teamMember.upsert({
          where: { teamId_memberId: { teamId: teamIds.get(teamName)!, memberId: member.id } },
          update: {},
          create: { teamId: teamIds.get(teamName)!, memberId: member.id },
        });
      }
    }

    return {
      organizationId: organization.id,
      organization: organization.name,
      members: PEOPLE.length,
      teams: TEAMS.length,
    };
  });
}

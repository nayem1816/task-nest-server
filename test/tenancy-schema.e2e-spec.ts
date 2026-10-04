import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Constraints the application relies on but does not re-check in code. If a
 * schema change drops one of these, this suite is what notices.
 */
describe('tenancy schema constraints (e2e)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const suffix = Date.now().toString(36);

  async function createOrgWithRole(slug: string) {
    const organization = await prisma.organization.create({
      data: { name: slug, slug: `${slug}-${suffix}` },
    });
    const role = await prisma.role.create({
      data: { organizationId: organization.id, key: 'agent', name: 'Agent', permissions: [] },
    });
    return { organization, role };
  }

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: { endsWith: suffix } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}.test` } } });
    await prisma.$disconnect();
  });

  it('treats emails as case-insensitive', async () => {
    await prisma.user.create({ data: { email: `Ana@${suffix}.test`, name: 'Ana' } });

    await expect(
      prisma.user.create({ data: { email: `ana@${suffix}.test`, name: 'Ana again' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows one membership per user per organization', async () => {
    const { organization, role } = await createOrgWithRole('dup-member');
    const user = await prisma.user.create({ data: { email: `bo@${suffix}.test`, name: 'Bo' } });
    const data = { organizationId: organization.id, userId: user.id, roleId: role.id };

    await prisma.organizationMember.create({ data });

    await expect(prisma.organizationMember.create({ data })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('refuses to delete a role that members still hold', async () => {
    const { organization, role } = await createOrgWithRole('role-in-use');
    const user = await prisma.user.create({ data: { email: `cy@${suffix}.test`, name: 'Cy' } });
    await prisma.organizationMember.create({
      data: { organizationId: organization.id, userId: user.id, roleId: role.id },
    });

    await expect(prisma.role.delete({ where: { id: role.id } })).rejects.toBeDefined();
  });

  it('removes memberships and teams with the organization, but keeps the user', async () => {
    const { organization, role } = await createOrgWithRole('cascade');
    const user = await prisma.user.create({ data: { email: `di@${suffix}.test`, name: 'Di' } });
    const member = await prisma.organizationMember.create({
      data: { organizationId: organization.id, userId: user.id, roleId: role.id },
    });
    const team = await prisma.team.create({
      data: { organizationId: organization.id, name: 'Support' },
    });
    await prisma.teamMember.create({ data: { teamId: team.id, memberId: member.id } });

    // Members hold a RESTRICT reference to their role; the org cascade must still go through.
    await prisma.organization.delete({ where: { id: organization.id } });

    await expect(prisma.organizationMember.count({ where: { id: member.id } })).resolves.toBe(0);
    await expect(prisma.team.count({ where: { id: team.id } })).resolves.toBe(0);
    await expect(prisma.user.count({ where: { id: user.id } })).resolves.toBe(1);
  });
});

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { seedDemoContacts } from './demo-contacts.js';
import { DEMO_PASSWORD, seedDemoWorkspace } from './demo-workspace.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed demo data into a production database.');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set.');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const workspace = await seedDemoWorkspace(prisma);
  const contacts = await seedDemoContacts(prisma, workspace.organizationId);
  console.log(
    `Seeded ${workspace.organization}: ${workspace.members} members, ${workspace.teams} teams, ` +
      `${contacts.contacts} new contacts, ${contacts.tags} tags.`,
  );
  console.log(`Sign in as maya@northstarcoffee.co (owner) with password "${DEMO_PASSWORD}".`);
} finally {
  await prisma.$disconnect();
}

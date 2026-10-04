import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { seedDemoWorkspace } from './demo-workspace.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed demo data into a production database.');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set.');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const summary = await seedDemoWorkspace(prisma);
  console.log(
    `Seeded ${summary.organization}: ${summary.members} members, ${summary.teams} teams.`,
  );
} finally {
  await prisma.$disconnect();
}

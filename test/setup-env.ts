import { config } from 'dotenv';

// Local runs read .env; CI provides the variables directly.
config({ quiet: true });

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'warn';
process.env.WORKERS_ENABLED = 'false';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

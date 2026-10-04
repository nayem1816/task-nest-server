import { config } from 'dotenv';

// Local runs read .env; CI provides the variables directly.
config({ quiet: true });

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'warn';
process.env.WORKERS_ENABLED = 'false';
process.env.EDGE_PROXY_SECRET = 'e2e-proxy-secret-that-is-long-enough';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
// A separate Redis database keeps a locally running API's workers from picking
// up jobs the tests enqueue, and keeps test rate-limit counters out of dev.
if (process.env.TEST_REDIS_URL) {
  process.env.REDIS_URL = process.env.TEST_REDIS_URL;
}

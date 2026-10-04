import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  APP_URL: z.url({ protocol: /^https?$/ }),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  /** Proxies in front of the API (load balancer, platform router); 0 when exposed directly. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  SWAGGER_ENABLED: booleanString.default(false),
  /** Run queue processors in this process. Off for API-only replicas. */
  WORKERS_ENABLED: booleanString.default(true),

  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Defaults to true outside development; browsers drop Secure cookies on plain http. */
  COOKIE_SECURE: booleanString.optional(),

  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  MAIL_FROM: z.string().min(3).default('TaskNest <no-reply@tasknest.app>'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Used as ConfigModule's `validate` hook, so a misconfigured deployment fails at
 * boot with every problem listed, instead of at the first request that needs the value.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

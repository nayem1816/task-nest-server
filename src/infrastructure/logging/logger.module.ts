import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { resolveRequestId } from '../../common/http/request-id.js';
import type { Env } from '../../config/env.js';

// Anything that can carry a credential. Pino replaces these before the line is
// written, so they never reach log storage.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
];

export const AppLoggerModule = LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => {
    const isDev = config.get('NODE_ENV', { infer: true }) === 'development';
    return {
      pinoHttp: {
        level: config.get('LOG_LEVEL', { infer: true }),
        genReqId: resolveRequestId,
        redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
        autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
        customProps: () => ({ service: 'api' }),
        transport: isDev
          ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss.l' } }
          : undefined,
      },
    };
  },
});

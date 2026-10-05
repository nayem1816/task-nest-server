import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express } from 'express';
import helmet from 'helmet';
import { Logger, PinoLogger } from 'nestjs-pino';
import { clientIpMiddleware } from './common/http/client-ip.js';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { REQUEST_ID_HEADER } from './common/http/request-id.js';
import type { Env } from './config/env.js';
import { REDIS } from './infrastructure/redis/redis.module.js';
import { CSRF_HEADER, REFRESH_COOKIE } from './modules/auth/refresh-cookie.js';
import {
  ORGANIZATION_HEADER,
  WORKSPACE_SECURITY,
} from './modules/authorization/tenant.decorators.js';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter.js';

/**
 * Everything that shapes the HTTP surface lives here, so the e2e suite boots
 * exactly the same app as `main.ts`.
 */
export async function configureApp(app: INestApplication): Promise<void> {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  const proxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (proxyHops > 0) {
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', proxyHops);
  }

  // Written knowledge articles can run to a few hundred KB; everything else is small.
  (app as NestExpressApplication).useBodyParser('json', { limit: '1mb' });

  app.use(clientIpMiddleware(config.get('EDGE_PROXY_SECRET', { infer: true })));
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new HttpExceptionFilter(await app.resolve(PinoLogger)));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
    }),
  );

  const origins = [
    config.get('APP_URL', { infer: true }),
    ...config.get('CORS_ORIGINS', { infer: true }),
  ];
  const logger = await app.resolve(PinoLogger);
  app.useWebSocketAdapter(
    new RedisIoAdapter(app, app.get(REDIS), origins, (err) =>
      logger.warn({ err }, 'Realtime Redis connection error'),
    ),
  );

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: origins,
    credentials: true,
    allowedHeaders: [
      'content-type',
      'authorization',
      CSRF_HEADER,
      REQUEST_ID_HEADER,
      ORGANIZATION_HEADER,
    ],
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('TaskNest API')
        .setDescription(
          'REST API for the TaskNest workspace. Errors share one shape: ' +
            '`{ "error": { "code", "message", "details?", "requestId" } }`.',
        )
        .setVersion('1')
        .addBearerAuth()
        .addCookieAuth(REFRESH_COOKIE)
        .addApiKey(
          {
            type: 'apiKey',
            in: 'header',
            name: ORGANIZATION_HEADER,
            description: 'Id of the workspace to act in. Required on workspace routes.',
          },
          WORKSPACE_SECURITY,
        )
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json' });
  }
}

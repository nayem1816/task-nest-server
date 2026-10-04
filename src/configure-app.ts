import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import { Logger, PinoLogger } from 'nestjs-pino';
import { clientIpMiddleware } from './common/http/client-ip.js';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { REQUEST_ID_HEADER } from './common/http/request-id.js';
import type { Env } from './config/env.js';
import { CSRF_HEADER, REFRESH_COOKIE } from './modules/auth/refresh-cookie.js';

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

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: [
      config.get('APP_URL', { infer: true }),
      ...config.get('CORS_ORIGINS', { infer: true }),
    ],
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', CSRF_HEADER, REQUEST_ID_HEADER],
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
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json' });
  }
}

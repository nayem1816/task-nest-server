import { type INestApplication, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger, PinoLogger } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { REQUEST_ID_HEADER } from './common/http/request-id.js';
import type { Env } from './config/env.js';

/**
 * Everything that shapes the HTTP surface lives here, so the e2e suite boots
 * exactly the same app as `main.ts`.
 */
export async function configureApp(app: INestApplication): Promise<void> {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new HttpExceptionFilter(await app.resolve(PinoLogger)));

  app.use(helmet());
  app.enableCors({
    origin: [
      config.get('APP_URL', { infer: true }),
      ...config.get('CORS_ORIGINS', { infer: true }),
    ],
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('TaskNest API')
        .setDescription('REST API for the TaskNest workspace.')
        .setVersion('1')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json' });
  }
}

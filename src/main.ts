import './datadog';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as express from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import helmet from 'helmet';

import {
  construirOpcionesCors,
  construirOrigenesPermitidos,
} from './common/config/cors.config';
import { swaggerHabilitado } from './common/config/swagger.config';
import {
  cabecerasSeguridadUploads,
  directorioUploads,
} from './common/config/uploads.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Usar Winston como el Logger principal de NestJS
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // Servir archivos estáticos subidos (/uploads)
  //
  // El directorio lo fija `UPLOADS_DIR` (por defecto `<cwd>/uploads`). En
  // Docker debe ser un VOLUMEN PERSISTENTE: el sistema de ficheros del
  // contenedor es efímero.
  app.use(
    '/uploads',
    express.static(directorioUploads(), {
      setHeaders: (res) => {
        for (const [cabecera, valor] of Object.entries(
          cabecerasSeguridadUploads(),
        )) {
          res.setHeader(cabecera, valor);
        }
      },
    }),
  );

  // OWASP A05: Cabeceras de Seguridad
  // Helmet configura automáticamente cabeceras HTTP que previenen XSS, Clickjacking, y ocultan información del servidor.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  // OWASP A05: Cross-Origin Resource Sharing (CORS)
  // Restringe qué dominios pueden hacer peticiones a nuestra API: la lista es
  // EXPLICITA (nunca `*`, porque la API sirve con credenciales).
  app.enableCors(construirOpcionesCors(construirOrigenesPermitidos()));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // OWASP A05: Ocultar documentación en Producción
  // Swagger expone la superficie completa de la API. En producción NO se publica
  // por defecto; se puede habilitar explícitamente con SWAGGER_HABILITADO=true.
  if (swaggerHabilitado()) {
    const config = new DocumentBuilder()
      .setTitle('Barbería API')
      .setDescription('La API del sistema de gestión de Barbería VIP')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, documentFactory);
  }

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error('Error starting the application:', err);
  process.exit(1);
});

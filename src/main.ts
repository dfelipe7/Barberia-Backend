import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'node:path';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Usar Winston como el Logger principal de NestJS
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // Servir archivos estáticos subidos (/uploads)
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  // OWASP A05: Cabeceras de Seguridad
  // Helmet configura automáticamente cabeceras HTTP que previenen XSS, Clickjacking, y ocultan información del servidor.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  // OWASP A05: Cross-Origin Resource Sharing (CORS)
  // Restringe qué dominios pueden hacer peticiones a nuestra API. Solo permitimos a nuestro Frontend autorizado.
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://barberia-frontend-production.up.railway.app',
  ];
  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL.replace(/\/$/, ''));
  }

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // `X-Negocio-Slug` selecciona la barbería de la petición (alternativa al
    // subdominio). No transporta credenciales: la autorización se resuelve
    // aparte contra la pertenencia de la persona a ese negocio.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Negocio-Slug'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // OWASP A05: Ocultar documentación en Producción
  // Swagger expone todos nuestros endpoints. En este caso lo habilitamos siempre para facilitar pruebas.
  const config = new DocumentBuilder()
    .setTitle('Barbería API')
    .setDescription('La API del sistema de gestión de Barbería VIP')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, documentFactory);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error('Error starting the application:', err);
  process.exit(1);
});

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // OWASP A05: Cabeceras de Seguridad
  // Helmet configura automáticamente cabeceras HTTP que previenen XSS, Clickjacking, y ocultan información del servidor.
  app.use(helmet());

  // OWASP A05: Cross-Origin Resource Sharing (CORS)
  // Restringe qué dominios pueden hacer peticiones a nuestra API. Solo permitimos a nuestro Frontend autorizado.
  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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
  // Swagger expone todos nuestros endpoints. Solo lo habilitamos en desarrollo.
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Barbería API')
      .setDescription('La API del sistema de gestión de Barbería VIP')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, documentFactory);
  }

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
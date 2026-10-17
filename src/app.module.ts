import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { MailerModule } from '@nestjs-modules/mailer';
import { AuthModule } from './auth/auth.module';
import { ClientesAuthModule } from './auth/clientes/clientes-auth.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { PrismaModule } from './prisma/prisma.module';
import { BootstrapService } from './bootstrap/bootstrap.service';
import { ServiciosModule } from './modules/servicios/servicios.module';
import { HorariosModule } from './modules/horarios/horarios.module';
import { ReservasModule } from './modules/reservas/reservas.module';
import { AppLoggerModule } from './logger/logger.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AllExceptionsFilter } from './logger/all-exceptions.filter';

import { ScheduleModule } from '@nestjs/schedule';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    // OWASP A04: Rate Limiting (Límite de Peticiones)
    // Previene ataques de fuerza bruta y DDoS limitando a 100 peticiones por minuto por IP.
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    // Módulo de envíos de correos electrónicos
    MailerModule.forRoot({
      transport: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number.parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true', // true para 465, false para otros
        auth: {
          user: process.env.SMTP_USER || 'tu-correo@gmail.com',
          pass: process.env.SMTP_PASS || 'tu-contrasena-de-aplicacion',
        },
      },
      defaults: {
        from: '"Seguridad Barbería" <seguridad@barberia.com>',
      },
    }),
    AuthModule,
    ClientesAuthModule,
    UsuariosModule,
    ServiciosModule,
    HorariosModule,
    ReservasModule,
    WhatsAppModule,
    PrismaModule,
    AppLoggerModule,
    AlertsModule,
  ],
  providers: [
    BootstrapService,
    // Activa el guardia de Throttler globalmente en todos los endpoints
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Activa el filtro de excepciones global con inyección de dependencias
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}

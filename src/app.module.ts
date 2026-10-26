/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: registrar el health check (AppController) que no estaba montado.
 * - Responsabilidad: composición de la aplicación. No define reglas de negocio.
 */
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { MailerModule } from '@nestjs-modules/mailer';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ClientesAuthModule } from './auth/clientes/clientes-auth.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { PrismaModule } from './prisma/prisma.module';
import { BootstrapService } from './bootstrap/bootstrap.service';
import { ServiciosModule } from './modules/servicios/servicios.module';
import { HorariosModule } from './modules/horarios/horarios.module';
import { ReservasModule } from './modules/reservas/reservas.module';
import { ConfiguracionModule } from './modules/configuracion/configuracion.module';
import { NegociosModule } from './modules/negocios/negocios.module';
import { NegocioContextoMiddleware } from './modules/negocios/middleware/negocio-contexto.middleware';
import { PerfilNegocioModule } from './modules/perfil-negocio/perfil-negocio.module';
import { AppLoggerModule } from './logger/logger.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AllExceptionsFilter } from './logger/all-exceptions.filter';

import { ScheduleModule } from '@nestjs/schedule';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';

@Module({
  // El health check (GET /) solo responde si el controlador está registrado:
  // sin esta línea, la ruta no existe y devuelve 404.
  controllers: [AppController],
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
    ConfiguracionModule,
    NegociosModule,
    PerfilNegocioModule,
    AppLoggerModule,
    AlertsModule,
  ],
  providers: [
    AppService,
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
export class AppModule implements NestModule {
  /**
   * Registra el middleware de contexto de negocio para TODAS las rutas.
   *
   * Va en un MIDDLEWARE y no en un guard porque el contexto se apoya en
   * `AsyncLocalStorage` y debe acompañar a toda la cadena asíncrona de la
   * petición (controlador -> servicio -> repositorio). Un guard se ejecuta
   * cuando el router ya ha encadenado el resto, y su `run()` no abarca de
   * forma fiable los tramos asíncronos posteriores.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

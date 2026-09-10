import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { PrismaModule } from './prisma/prisma.module';
import { BootstrapService } from './bootstrap/bootstrap.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // OWASP A04: Rate Limiting (Límite de Peticiones)
    // Previene ataques de fuerza bruta y DDoS limitando a 100 peticiones por minuto por IP.
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    AuthModule,
    UsuariosModule,
    PrismaModule,
  ],
  providers: [
    BootstrapService,
    // Activa el guardia de Throttler globalmente en todos los endpoints
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
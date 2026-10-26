import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { GoogleAuthService } from './google/google-auth.service';
import { GoogleTokenVerifier } from './google/google-token-verifier.service';
import { AuthController } from './auth.controller';
import { RolesGuard } from './roles/roles.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtSesionGuard } from './guards/jwt-sesion.guard';
import { PersonalJwtService } from './sesion/personal-jwt.service';
import { SesionPersonalService } from './sesion/sesion-personal.service';

/**
 * Módulo de autenticación del personal (barbería).
 *
 * SIN SECRETO DE RESPALDO: `JWT_SECRET` no tiene valor por defecto. Cada
 * servicio de sesión resuelve su secreto de forma PEREZOSA y falla de forma
 * controlada (503) si falta, en lugar de firmar con una clave conocida.
 * `PersonalJwtService` y `ClienteJwtService` usan secretos DISTINTOS, de
 * modo que un token de una clase nunca es aceptado por los guards de la otra.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ??
            '7d') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  providers: [
    GoogleAuthService,
    GoogleTokenVerifier,
    RolesGuard,
    JwtAuthGuard,
    JwtSesionGuard,
    PersonalJwtService,
    SesionPersonalService,
  ],
  controllers: [AuthController],
  exports: [
    GoogleAuthService,
    GoogleTokenVerifier,
    RolesGuard,
    JwtAuthGuard,
    JwtSesionGuard,
    PersonalJwtService,
    SesionPersonalService,
    JwtModule,
  ],
})
export class AuthModule {}

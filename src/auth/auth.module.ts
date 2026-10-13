import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { KeycloakService } from './keycloak/keycloak.service';
import { GoogleAuthService } from './google/google-auth.service';
import { AuthController } from './auth.controller';
import { RolesGuard } from './roles/roles.guard';
import { KeycloakAuthGuard } from './keycloak-auth/keycloak-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>(
          'JWT_SECRET',
          'barberia-jwt-secret-key-super-segura-2026-production-token',
        ),
        signOptions: {
          expiresIn: '7d',
        },
      }),
    }),
  ],
  providers: [
    KeycloakService,
    GoogleAuthService,
    RolesGuard,
    KeycloakAuthGuard,
  ],
  controllers: [AuthController],
  exports: [
    KeycloakService,
    GoogleAuthService,
    RolesGuard,
    KeycloakAuthGuard,
    JwtModule,
  ],
})
export class AuthModule {}
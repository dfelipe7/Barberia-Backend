import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { GoogleAuthService } from './google/google-auth.service';
import { GoogleTokenVerifier } from './google/google-token-verifier.service';
import { AuthController } from './auth.controller';
import { RolesGuard } from './roles/roles.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

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
  providers: [GoogleAuthService, GoogleTokenVerifier, RolesGuard, JwtAuthGuard],
  controllers: [AuthController],
  exports: [
    GoogleAuthService,
    GoogleTokenVerifier,
    RolesGuard,
    JwtAuthGuard,
    JwtModule,
  ],
})
export class AuthModule {}

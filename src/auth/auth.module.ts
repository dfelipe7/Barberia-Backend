import { Module } from '@nestjs/common';
import { KeycloakService } from './keycloak/keycloak.service';
import { AuthController } from './auth.controller';
import { RolesGuard } from './roles/roles.guard';

@Module({
  providers: [
    KeycloakService,
    RolesGuard,
  ],
  controllers: [AuthController],
  exports: [
    KeycloakService,
    RolesGuard,
  ],
})
export class AuthModule {}
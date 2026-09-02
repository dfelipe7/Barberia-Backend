import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';

import { RolesGuard } from './roles/roles.guard';
import { Roles } from './roles/roles.decorator';
import { KeycloakService } from './keycloak/keycloak.service';
import { KeycloakAuthGuard } from './keycloak-auth/keycloak-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly keycloakService: KeycloakService,
  ) {}
@Get('keycloak-test')
@UseGuards(KeycloakAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
async probarKeycloak() {
  const token =
    await this.keycloakService.obtenerTokenAdministrativo();

  return {
    mensaje: 'Backend autenticado correctamente con Keycloak',
    tokenObtenido: !!token,
  };
}

@Get('superadmins-keycloak')
@UseGuards(KeycloakAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
async obtenerSuperadminsKeycloak() {
  return this.keycloakService.obtenerUsuariosPorRol(
    'SUPERADMIN',
  );
}

}
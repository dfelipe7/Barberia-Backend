import {
  Controller,
  Get,
  Patch,
  Body,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';

import { RolesGuard } from './roles/roles.guard';
import { Roles } from './roles/roles.decorator';
import { KeycloakService } from './keycloak/keycloak.service';
import { KeycloakAuthGuard } from './keycloak-auth/keycloak-auth.guard';
import { CambiarContrasenaDto } from './dto/cambiar-contrasena.dto';

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

/**
 * Endpoint para que un usuario logueado cambie su propia contraseña.
 * Primero verifica la contraseña actual antes de permitir el cambio.
 */
@Patch('cambiar-contrasena')
@UseGuards(KeycloakAuthGuard)
async cambiarContrasena(
  @Req() req: any,
  @Body() dto: CambiarContrasenaDto,
) {
  const keycloakId = req.user?.sub;
  const email = req.user?.email;

  if (!keycloakId || !email) {
    throw new UnauthorizedException('No se pudo identificar al usuario.');
  }

  const contrasenaCorrecta = await this.keycloakService.verificarContrasena(email, dto.contrasenaActual);
  if (!contrasenaCorrecta) {
    throw new UnauthorizedException('La contraseña actual es incorrecta.');
  }

  await this.keycloakService.cambiarContrasena(keycloakId, dto.nuevaContrasena);

  return { mensaje: 'Contraseña actualizada correctamente.' };
}

}
import {
  Controller,
  Post,
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
import { GoogleAuthService } from './google/google-auth.service';
import { GoogleLoginDto } from './google/dto/google-login.dto';
import { KeycloakAuthGuard } from './keycloak-auth/keycloak-auth.guard';
import { CambiarContrasenaDto } from './dto/cambiar-contrasena.dto';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly googleAuthService: GoogleAuthService,
  ) {}

  @Post('google')
  @ApiOperation({
    summary: 'Iniciar sesión con Google OAuth 2.0',
    description:
      'Valida el ID Token de Google, busca al usuario en la barbería y devuelve el JWT de sesión con su rol.',
  })
  @ApiOkResponse({
    description: 'Sesión iniciada exitosamente con Google.',
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        usuario: {
          id: 1,
          email: 'armeroduvan8@gmail.com',
          nombre: 'Duvan Felipe',
          apellido: 'Armero',
          rol: 'SUPERADMIN',
          estado: 'ACTIVO',
          fotoUrl: 'https://lh3.googleusercontent.com/...',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'El token de Google es inválido o el usuario no está registrado en el sistema.',
  })
  @ApiForbiddenResponse({
    description: 'La cuenta ha sido desactivada por un administrador.',
  })
  async loginConGoogle(@Body() dto: GoogleLoginDto) {
    return this.googleAuthService.loginConGoogle(dto.idToken);
  }

  @Get('keycloak-test')
  @ApiBearerAuth()
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({
    summary: 'Probar conexión con Keycloak',
    description:
      'Verifica que el backend pueda obtener un token administrativo de Keycloak.',
  })
  @ApiOkResponse({
    description: 'Conexión exitosa.',
    schema: {
      example: {
        mensaje: 'Backend autenticado correctamente con Keycloak',
        tokenObtenido: true,
      },
    },
  })
  @ApiForbiddenResponse({ description: 'No tienes permisos de SUPERADMIN.' })
  async probarKeycloak() {
    const token = await this.keycloakService.obtenerTokenAdministrativo();

    return {
      mensaje: 'Backend autenticado correctamente con Keycloak',
      tokenObtenido: !!token,
    };
  }

  @Get('superadmins-keycloak')
  @ApiBearerAuth()
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({
    summary: 'Listar superadmins en Keycloak',
    description:
      'Obtiene todos los usuarios que tienen el rol SUPERADMIN directamente en Keycloak.',
  })
  @ApiOkResponse({
    description: 'Lista de superadmins obtenida.',
    schema: { example: [{ id: 'uuid', username: 'admin', email: 'admin@admin.com' }] },
  })
  @ApiForbiddenResponse({ description: 'No tienes permisos de SUPERADMIN.' })
  async obtenerSuperadminsKeycloak() {
    return this.keycloakService.obtenerUsuariosPorRol('SUPERADMIN');
  }

  /**
   * Endpoint para que un usuario logueado cambie su propia contraseña.
   * Primero verifica la contraseña actual antes de permitir el cambio.
   */
  @Patch('cambiar-contrasena')
  @ApiBearerAuth()
  @UseGuards(KeycloakAuthGuard)
  @ApiOperation({
    summary: 'Cambiar contraseña',
    description:
      'Permite al usuario autenticado cambiar su contraseña, validando la actual.',
  })
  @ApiOkResponse({
    description: 'Contraseña actualizada correctamente.',
    schema: { example: { mensaje: 'Contraseña actualizada correctamente.' } },
  })
  @ApiUnauthorizedResponse({
    description: 'La contraseña actual es incorrecta o el usuario no está logueado.',
  })
  async cambiarContrasena(@Req() req: any, @Body() dto: CambiarContrasenaDto) {
    const keycloakId = req.user?.sub;
    const email = req.user?.email;

    if (!keycloakId || !email) {
      throw new UnauthorizedException('No se pudo identificar al usuario.');
    }

    const contrasenaCorrecta = await this.keycloakService.verificarContrasena(
      email,
      dto.contrasenaActual,
    );
    if (!contrasenaCorrecta) {
      throw new UnauthorizedException('La contraseña actual es incorrecta.');
    }

    await this.keycloakService.cambiarContrasena(
      keycloakId,
      dto.nuevaContrasena,
    );

    return { mensaje: 'Contraseña actualizada correctamente.' };
  }
}
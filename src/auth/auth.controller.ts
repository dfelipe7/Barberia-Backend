import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { GoogleAuthService } from './google/google-auth.service';
import { GoogleLoginDto } from './google/dto/google-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly googleAuthService: GoogleAuthService) {}

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
          roles: ['SUPERADMIN'],
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

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Renueva el JWT de sesión con los roles y perfiles vigentes en la base de datos',
    description:
      'Permite actualizar los permisos de sesión de inmediato cuando a un usuario se le asigna o revoca un rol, sin obligarlo a cerrar sesión.',
  })
  @ApiOkResponse({
    description: 'Token renovado con roles vigentes.',
  })
  @ApiUnauthorizedResponse({
    description: 'El token actual es inválido o expiró.',
  })
  @ApiForbiddenResponse({
    description: 'El usuario ya no cuenta con roles activos o fue desactivado.',
  })
  async refrescarToken(@Req() req: any) {
    const usuarioId = Number(req.user?.id ?? req.user?.sub);
    const fotoUrlActual = req.user?.fotoUrl ?? null;
    return this.googleAuthService.refrescarSesion(usuarioId, fotoUrlActual);
  }
}

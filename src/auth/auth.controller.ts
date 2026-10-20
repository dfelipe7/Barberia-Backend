import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Param,
  UnauthorizedException,
} from '@nestjs/common';
import { GoogleAuthService } from './google/google-auth.service';
import { GoogleLoginDto } from './google/dto/google-login.dto';
import { JwtSesionGuard } from './guards/jwt-sesion.guard';
import { SesionPersonalService } from './sesion/sesion-personal.service';
import {
  ClaimsSesionPersonal,
  extraerSesionPersonal,
} from './sesion/sesion-personal';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';

/** Petición con la sesión de personal verificada por el guard. */
interface PeticionSesion {
  user?: ClaimsSesionPersonal;
}

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly googleAuthService: GoogleAuthService,
    private readonly sesionService: SesionPersonalService,
  ) {}

  @Post('google')
  @ApiOperation({
    summary: 'Iniciar sesión con Google OAuth 2.0',
    description:
      'Valida el ID Token de Google, busca al usuario en la plataforma y devuelve el JWT de sesión. Los roles del token son los EFECTIVOS en la barbería de la petición (perfiles Administrador/Barbero activos).',
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
        negocio: { id: 1, slug: 'kyrios-studio' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'El token de Google es inválido o el usuario no está registrado en el sistema.',
  })
  @ApiForbiddenResponse({
    description:
      'La cuenta está desactivada o la persona no tiene un perfil activo en esta barbería.',
  })
  async loginConGoogle(@Body() dto: GoogleLoginDto) {
    return this.googleAuthService.loginConGoogle(dto.idToken);
  }

  @Post('refresh')
  @UseGuards(JwtSesionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Renueva el JWT de sesión con los roles y perfiles vigentes en la base de datos',
    description:
      'Revalida la sesión conservando su ámbito. En una sesión de negocio, comprueba que la barbería siga activa y recalcula los roles efectivos, de modo que revocar un perfil surte efecto de inmediato.',
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
  async refrescarToken(@Req() req: PeticionSesion) {
    const sesion = extraerSesionPersonal(req.user);
    const usuario = await this.sesionService.cargarUsuario(sesion.id);

    if (!usuario) {
      throw new UnauthorizedException('La sesión ya no es válida');
    }

    return this.sesionService.renovar(sesion, usuario);
  }

  @Post('tenant/:slug')
  @UseGuards(JwtSesionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambia explícitamente el negocio de la sesión',
    description:
      'Emite una sesión vinculada al negocio indicado por su slug. El destino se resuelve por el slug de la ruta contra los negocios activos, nunca por el contexto de la petición. Exige un perfil operativo activo en el negocio de destino; para un SUPERADMIN es un acceso privilegiado que queda registrado en la auditoría.',
  })
  @ApiParam({
    name: 'slug',
    example: 'kyrios-studio',
    description: 'Slug público del negocio de destino',
  })
  @ApiOkResponse({
    description: 'Sesión emitida para el negocio solicitado.',
  })
  @ApiUnauthorizedResponse({
    description: 'El token actual es inválido o expiró.',
  })
  @ApiForbiddenResponse({
    description:
      'La persona no tiene un perfil activo en el negocio solicitado.',
  })
  async cambiarNegocio(
    @Req() req: PeticionSesion,
    @Param('slug') slug: string,
  ) {
    return this.sesionService.cambiarNegocio(
      extraerSesionPersonal(req.user),
      slug,
    );
  }
}

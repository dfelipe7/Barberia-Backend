import {
  Controller,
  Post,
  Body,
} from '@nestjs/common';
import { GoogleAuthService } from './google/google-auth.service';
import { GoogleLoginDto } from './google/dto/google-login.dto';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
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
}
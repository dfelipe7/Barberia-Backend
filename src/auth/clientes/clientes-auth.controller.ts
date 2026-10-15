import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { GoogleLoginDto } from '../google/dto/google-login.dto';
import { ClientesAuthService } from './clientes-auth.service';
import { ClienteSesionResponseDto } from './dto/cliente-sesion-response.dto';

/**
 * Inicio de sesión de CLIENTES con Google (HE-04, Modalidad B).
 *
 * Es un flujo separado del login de personal (`POST /auth/google`): no exige
 * estar registrado ni tener rol, y emite un token con secreto y audiencia
 * propios que las rutas de personal rechazan.
 */
@ApiTags('Autenticación de clientes')
@Controller('auth/clientes')
export class ClientesAuthController {
  constructor(private readonly clientesAuthService: ClientesAuthService) {}

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Iniciar sesión como cliente con Google OAuth 2.0',
    description:
      'Valida el ID Token de Google (firma, emisor, audiencia, expiración y correo verificado), da de alta al cliente de forma idempotente por su cuenta de Google y devuelve un JWT de sesión de cliente.',
  })
  @ApiBody({ type: GoogleLoginDto })
  @ApiOkResponse({
    description: 'Sesión de cliente iniciada.',
    type: ClienteSesionResponseDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'El token de Google es inválido, expiró o la cuenta no tiene correo verificado.',
  })
  async loginConGoogle(
    @Body() dto: GoogleLoginDto,
  ): Promise<ClienteSesionResponseDto> {
    return this.clientesAuthService.loginConGoogle(dto.idToken);
  }
}

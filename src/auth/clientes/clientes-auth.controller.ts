import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { GoogleLoginDto } from '../google/dto/google-login.dto';
import { ClientesAuthService } from './clientes-auth.service';
import { ClienteSesionResponseDto } from './dto/cliente-sesion-response.dto';
import { ActualizarPerfilClienteDto } from './dto/actualizar-perfil-cliente.dto';
import { ClienteJwtAuthGuard } from './guards/cliente-jwt-auth.guard';
import { ClienteAutenticado } from './cliente-jwt.service';

interface RequestConCliente {
  cliente: ClienteAutenticado;
}

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
  /**
   * Obtiene el perfil completo del cliente que ha iniciado sesión.
   *
   * @param req - Objeto de petición con los datos criptográficamente verificados del cliente.
   * @returns Perfil del cliente (nombre, apellido, email, teléfono).
   * @throws {NotFoundException} Si el cliente no existe o fue desvinculado.
   * @throws {UnauthorizedException} Si el token de cliente es inválido o expiró.
   */
  @Get('perfil')
  @UseGuards(ClienteJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener el perfil del cliente autenticado' })
  async obtenerPerfil(@Req() req: RequestConCliente) {
    return this.clientesAuthService.obtenerPerfil(req.cliente.clienteId);
  }

  /**
   * Actualiza la información personal (nombre, apellido o teléfono de contacto) del cliente autenticado.
   *
   * @param req - Objeto de petición con la identidad del cliente autenticado.
   * @param dto - Datos modificables del perfil.
   * @returns Datos actualizados del cliente en la base de datos.
   * @throws {NotFoundException} Si el cliente no existe.
   * @throws {UnauthorizedException} Si el token de cliente es inválido o expiró.
   */
  @Patch('perfil')
  @UseGuards(ClienteJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualizar teléfono o datos del cliente autenticado',
  })
  async actualizarPerfil(
    @Req() req: RequestConCliente,
    @Body() dto: ActualizarPerfilClienteDto,
  ) {
    return this.clientesAuthService.actualizarPerfil(
      req.cliente.clienteId,
      dto,
    );
  }
}

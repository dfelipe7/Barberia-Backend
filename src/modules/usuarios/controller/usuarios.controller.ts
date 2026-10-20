import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { ActualizarUsuarioDto } from '../dto/dto-peticion/actualizar-usuario.dto';
import { CambiarEstadoUsuarioDto } from '../dto/dto-peticion/cambiar-estado-usuario.dto';
import { ConfigurarBarberoDto } from '../dto/dto-peticion/configurar-barbero.dto';
import { UsuarioPerfilDto } from '../dto/dto-respuesta/usuario-perfil.dto';
import { UsuariosService } from '../service/usuarios.service';
import { BarberosService } from '../service/barberos.service';

@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly barberosService: BarberosService,
  ) {}
  @Get('simular-error-grave')
  @ApiOperation({
    summary:
      'Simula un error 500 para probar el sistema de alertas por correo (A09)',
  })
  simularError() {
    throw new InternalServerErrorException(
      '¡Simulación de explosión del servidor (Error 500)!',
    );
  }

  @Post('me/barbero')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Configura el perfil del usuario actual como barbero',
  })
  @ApiOkResponse({ description: 'Perfil de barbero configurado con éxito.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos en el formulario.' })
  async configurarMiPerfilComoBarbero(
    @Req() request: any,
    @Body() dto: ConfigurarBarberoDto,
  ) {
    return this.barberosService.configurarBarbero(
      request.user.email || request.user.sub,
      dto,
    );
  }

  @Post('sincronizar-superadmin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({
    summary: 'Sincroniza el usuario superadmin en la base de datos',
  })
  @ApiOkResponse({ description: 'Sincronización exitosa.' })
  @ApiForbiddenResponse({
    description: 'No tienes permisos de superadministrador.',
  })
  async sincronizarSuperadmin() {
    return this.usuariosService.sincronizarSuperadmin();
  }

  /**
   * POST /usuarios/:usuarioId/barbero
   *
   * `usuarioId` es el `Usuario.id` (identidad global de la persona a la que se
   * le crea el perfil de barbero en esta barbería).
   */
  @Post(':usuarioId/barbero')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({
    summary: 'Configura el perfil de un usuario existente como barbero',
    description:
      'El identificador es el Usuario.id de la persona a la que se le crea el perfil de barbero.',
  })
  @ApiParam({
    name: 'usuarioId',
    description: 'ID del usuario (Usuario.id)',
    type: Number,
  })
  @ApiOkResponse({ description: 'Perfil de barbero configurado con éxito.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos.' })
  async configurarBarberoPorId(
    @Param('usuarioId') usuarioId: string,
    @Body() dto: ConfigurarBarberoDto,
  ) {
    return this.barberosService.configurarBarberoPorId(Number(usuarioId), dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Obtiene el perfil del usuario autenticado actual' })
  @ApiOkResponse({
    description: 'Datos del perfil actual.',
    type: UsuarioPerfilDto,
  })
  async obtenerMiPerfil(@Req() request: any) {
    return this.usuariosService.obtenerMiPerfil(request.user);
  }

  @Get(':usuarioId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Obtiene los datos de un usuario por su ID',
    description:
      'El identificador es el Usuario.id (identidad global de la persona). Para operar sobre el perfil de barbero de la barbería se usa el Barbero.id.',
  })
  @ApiParam({
    name: 'usuarioId',
    description: 'ID del usuario (Usuario.id)',
    type: Number,
  })
  @ApiOkResponse({
    description: 'Datos del usuario encontrado.',
    type: UsuarioPerfilDto,
  })
  @ApiForbiddenResponse({
    description: 'No tienes permiso para ver a este usuario.',
  })
  async obtenerUsuarioPorId(
    @Param('usuarioId') usuarioId: string,
    @Req() request: any,
  ) {
    return this.usuariosService.obtenerUsuarioPorId(
      Number(usuarioId),
      request.user,
    );
  }

  @Patch(':usuarioId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({ summary: 'Actualiza los datos de un usuario' })
  @ApiOkResponse({ description: 'Usuario actualizado exitosamente.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos.' })
  @ApiForbiddenResponse({
    description: 'No tienes permisos para editar a este usuario.',
  })
  async actualizarUsuario(
    @Param('usuarioId') usuarioId: string,
    @Body() dto: ActualizarUsuarioDto,
    @Req() request: any,
  ) {
    return this.usuariosService.actualizarUsuario(
      Number(usuarioId),
      dto,
      request.user,
    );
  }

  @Patch(':usuarioId/estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Cambia el estado (activo/inactivo) de un usuario' })
  @ApiOkResponse({
    description: 'Estado global del usuario cambiado exitosamente.',
  })
  @ApiForbiddenResponse({
    description:
      'Un Administrador no puede bloquear a otro Administrador o Superadmin.',
  })
  async cambiarEstadoUsuario(
    @Param('usuarioId') usuarioId: string,
    @Body() dto: CambiarEstadoUsuarioDto,
    @Req() request: any,
  ) {
    return this.usuariosService.cambiarEstadoUsuario(
      Number(usuarioId),
      dto,
      request.user,
    );
  }
}

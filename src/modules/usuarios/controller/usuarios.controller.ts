/**
 * Trazabilidad:
 * - REQ: REQ-009, REQ-010
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: proteger el simulador de error 500 y limitar su alcance a la administración del negocio.
 * - Responsabilidad: rutas de usuarios. No decide qué errores se notifican ni registra credenciales.
 */
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
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { ActualizarUsuarioDto } from '../dto/dto-peticion/actualizar-usuario.dto';
import { CambiarEstadoUsuarioGestionDto } from '../dto/dto-peticion/cambiar-estado-usuario-gestion.dto';
import { ConfigurarBarberoDto } from '../dto/dto-peticion/configurar-barbero.dto';
import { UsuarioPerfilDto } from '../dto/dto-respuesta/usuario-perfil.dto';
import { UsuariosService } from '../service/usuarios.service';
import { BarberosService } from '../service/barberos.service';
import { simuladorErrorHabilitado } from '../../../common/config/simulador-error.config';
import {
  ROL_ADMINISTRADOR,
  ROL_SUPERADMIN,
} from '../../negocios/negocios.constants';

@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly barberosService: BarberosService,
  ) {}

  /**
   * GET /usuarios/simular-error-grave
   *
   * Herramienta de diagnóstico de la cadena de alertas por correo (OWASP A09).
   *
   * REGLAS DE ACCESO
   * ----------------
   * 1. Exige sesión de personal válida (`JwtAuthGuard`): sin sesión responde
   *    401 y NO se envía ningún correo.
   * 2. Exige rol de administración del negocio (`SUPERADMIN` o `ADMINISTRADOR`).
   *    La comprobación es explícita y NO usa `RolesGuard` a propósito: `RolesGuard`
   *    responde 403 y el filtro global envía correo de alerta ante todo 403, de
   *    modo que un intento no autorizado podría generar correo. Aquí se responde
   *    404, que no genera alerta.
   * 3. Está deshabilitado salvo habilitación explícita
   *    (`SIMULADOR_ERROR_HABILITADO=true`) y NUNCA en producción
   *    (`NODE_ENV=production`). Si está deshabilitado responde 404.
   *
   * Un 404 con la habilitación activa solo se da cuando la ruta no existe para
   * quien pregunta: ni la existencia de la ruta ni la del dato se revelan.
   */
  @Get('simular-error-grave')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Simula un error 500 para probar el sistema de alertas por correo (A09)',
    description:
      'Diagnóstico de la cadena de alertas: exige sesión de personal, rol de administración del negocio y habilitación explícita por entorno. Deshabilitado siempre en producción. Un intento no autorizado no genera correo de alerta.',
  })
  @ApiUnauthorizedResponse({
    description: 'No hay sesión de personal válida.',
  })
  @ApiNotFoundResponse({
    description:
      'El simulador está deshabilitado en este entorno o la persona no es de la administración.',
  })
  simularError(@Req() request: { user?: { roles?: string[] } }) {
    if (!simuladorErrorHabilitado()) {
      throw new NotFoundException();
    }

    if (!this.esAdministracion(request?.user?.roles)) {
      throw new NotFoundException();
    }

    throw new InternalServerErrorException(
      '¡Simulación de explosión del servidor (Error 500)!',
    );
  }

  /**
   * ¿La sesión es de la administración del negocio?
   *
   * @param roles Roles efectivos de la sesión (`request.user.roles`).
   */
  private esAdministracion(roles: string[] | undefined): boolean {
    const rolesSesion = new Set<string>(Array.isArray(roles) ? roles : []);
    return (
      rolesSesion.has(ROL_SUPERADMIN) || rolesSesion.has(ROL_ADMINISTRADOR)
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

  /**
   * POST /usuarios/:usuarioId/barbero
   *
   * `usuarioId` es el `Usuario.id` (identidad global de la persona a la que se
   * le crea el perfil de barbero en esta barbería).
   */
  @Post(':usuarioId/barbero')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
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
    @Req() request?: any,
  ) {
    const actor = request?.user;
    if (actor) {
      const esSuperAdmin =
        Array.isArray(actor?.roles) && actor.roles.includes('SUPERADMIN');
      const esMismoUsuario = Number(actor?.id) === Number(usuarioId);

      if (!esSuperAdmin && !esMismoUsuario) {
        throw new ForbiddenException(
          'Solo puedes configurar tu propio perfil de barbero',
        );
      }
    }

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
  @ApiOperation({
    summary:
      'Cambia el estado de una membresía del usuario en la barbería actual',
  })
  @ApiOkResponse({
    description: 'Estado de la membresía cambiado exitosamente.',
  })
  @ApiForbiddenResponse({
    description:
      'No tienes permisos para cambiar el estado de esta membresía.',
  })
  async cambiarEstadoUsuario(
    @Param('usuarioId') usuarioId: string,
    @Body() dto: CambiarEstadoUsuarioGestionDto,
    @Req() request: any,
  ) {
    return this.usuariosService.cambiarEstadoUsuario(
      Number(usuarioId),
      dto,
      request.user,
    );
  }
}

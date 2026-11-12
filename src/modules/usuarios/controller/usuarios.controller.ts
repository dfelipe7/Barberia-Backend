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
import { ClaimsSesionPersonal } from '../../../auth/sesion/sesion-personal';

/** Petición HTTP con sesión obligatoria de personal. */
export interface RequestConUsuario {
  user?: Partial<ClaimsSesionPersonal>;
}

/** Petición HTTP con sesión opcional de personal para escenarios de aprovisionamiento. */
export interface RequestConUsuarioOpcional {
  user?: Partial<ClaimsSesionPersonal>;
}

/**
 * Controlador de Identidad de Usuarios, Perfil Propio y Diagnóstico de Alertas.
 *
 * @remarks
 * Administra el perfil del usuario autenticado (`/usuarios/me`), la habilitación de roles operativos,
 * la actualización de datos generales de cuenta y el endpoint de prueba controlada de fallos (OWASP A09).
 */
@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly barberosService: BarberosService,
  ) {}

  /**
   * Endpoint de diagnóstico que simula un fallo crítico (Error 500) para verificar la emisión de alertas.
   *
   * @remarks
   * Conforme a OWASP A09 (Security Logging and Monitoring Failures):
   * Exige sesión válida de personal y rol administrativo. Se desactiva indefectiblemente en producción (`NODE_ENV=production`).
   * Ante intentos no autorizados o entornos no habilitados, responde con `404 Not Found` uniforme sin activar alertas.
   *
   * @param request - Petición HTTP con los roles de la sesión activa.
   * @throws {NotFoundException} Si el simulador está inactivo o el usuario carece de roles administrativos.
   * @throws {InternalServerErrorException} Siempre que se cumplan las condiciones controladas de prueba.
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

  /**
   * Inicializa o configura el perfil de barbero del usuario actualmente autenticado.
   *
   * @param request - Petición HTTP con los datos de sesión del usuario.
   * @param dto - Parámetros de configuración del barbero (comisión, foto).
   * @returns Datos del perfil de barbero asociado.
   * @throws {BadRequestException} Si los datos son inválidos.
   */
  @Post('me/barbero')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Configura el perfil del usuario actual como barbero',
  })
  @ApiOkResponse({ description: 'Perfil de barbero configurado con éxito.' })
  @ApiBadRequestResponse({ description: 'Datos inválidos en el formulario.' })
  async configurarMiPerfilComoBarbero(
    @Req() request: RequestConUsuario,
    @Body() dto: ConfigurarBarberoDto,
  ) {
    return this.barberosService.configurarBarbero(
      (request.user?.email ?? request.user?.sub) as string,
      dto,
    );
  }

  /**
   * Configura el perfil de barbero de un usuario específico en la barbería activa.
   *
   * @param usuarioId - Identificador del usuario (`Usuario.id`).
   * @param dto - Parámetros de configuración del barbero.
   * @param request - Petición HTTP con claims de autorización.
   * @returns Datos del perfil configurado.
   * @throws {ForbiddenException} Si el usuario no es SUPERADMIN ni el propio titular de la cuenta.
   * @throws {BadRequestException} Si los datos son inválidos.
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
    @Req() request?: RequestConUsuarioOpcional,
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

  /**
   * Obtiene la ficha completa y membresías activas del colaborador autenticado.
   *
   * @param request - Petición HTTP con sesión del colaborador.
   * @returns Perfil con nombre, correo, roles y datos operativos.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Obtiene el perfil del usuario autenticado actual' })
  @ApiOkResponse({
    description: 'Datos del perfil actual.',
    type: UsuarioPerfilDto,
  })
  async obtenerMiPerfil(@Req() request: RequestConUsuario) {
    return this.usuariosService.obtenerMiPerfil(request.user);
  }

  /**
   * Obtiene la ficha de un usuario por su ID global (`Usuario.id`).
   *
   * @param usuarioId - Identificador único de usuario.
   * @param request - Petición con la sesión del actor que consulta.
   * @returns Datos del usuario consultado.
   * @throws {ForbiddenException} Si el solicitante no posee permisos para consultar a este usuario.
   */
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
    @Req() request: RequestConUsuario,
  ) {
    return this.usuariosService.obtenerUsuarioPorId(
      Number(usuarioId),
      request.user,
    );
  }

  /**
   * Actualiza los datos personales o atributos editables de un usuario.
   *
   * @param usuarioId - Identificador del usuario.
   * @param dto - Datos modificables.
   * @param request - Petición con la sesión del actor que solicita la edición.
   * @returns Datos actualizados del usuario.
   * @throws {ForbiddenException} Si carece de permisos para editar al usuario seleccionado.
   * @throws {BadRequestException} Si los datos son inválidos.
   */
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
    @Req() request: RequestConUsuario,
  ): Promise<unknown> {
    return this.usuariosService.actualizarUsuario(
      Number(usuarioId),
      dto,
      request.user,
    );
  }

  /**
   * Cambia el estado de una membresía operativa del usuario en la barbería actual.
   *
   * @param usuarioId - Identificador numérico del usuario.
   * @param dto - Nuevo estado y tipo de membresía a afectar.
   * @param request - Petición con la sesión del administrador.
   * @returns Registro actualizado de la membresía.
   * @throws {ForbiddenException} Si carece de permisos para alterar el estado de la membresía.
   */
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
    description: 'No tienes permisos para cambiar el estado de esta membresía.',
  })
  async cambiarEstadoUsuario(
    @Param('usuarioId') usuarioId: string,
    @Body() dto: CambiarEstadoUsuarioGestionDto,
    @Req() request: RequestConUsuario,
  ) {
    return this.usuariosService.cambiarEstadoUsuario(
      Number(usuarioId),
      dto,
      request.user,
    );
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { BloqueosHorarioService } from '../service/bloqueos-horario.service';
import { CrearBloqueoHorarioDto } from '../dto/dto-peticion/crear-bloqueo-horario.dto';
import { ActualizarBloqueoHorarioDto } from '../dto/dto-peticion/actualizar-bloqueo-horario.dto';
import { FiltroBloqueosHorarioDto } from '../dto/dto-peticion/filtro-bloqueos-horario.dto';
import {
  BloqueoHorarioAccionResponseDto,
  BloqueoHorarioResponseDto,
} from '../dto/dto-respuesta/bloqueo-horario-response.dto';

import { ClaimsSesionPersonal } from '../../../auth/sesion/sesion-personal';

/** Petición HTTP con sesión del barbero para gestión de bloqueos de agenda propia. */
export interface RequestConUsuario {
  user?: Partial<ClaimsSesionPersonal>;
}

/**
 * Controlador de Autogestión de Bloqueos de Horario del Barbero.
 *
 * @remarks
 * Permite a los barberos autenticados consultar, crear, modificar y cancelar bloqueos en su propia agenda
 * (citas médicas, permisos, descansos no programados) garantizando que no se superpongan con reservas activas.
 */
@ApiTags('Bloqueos de horario')
@ApiBearerAuth()
@Controller('usuarios/me/barbero')
export class BloqueosHorarioController {
  constructor(
    private readonly bloqueosHorarioService: BloqueosHorarioService,
  ) {}

  /**
   * POST /usuarios/me/barbero/bloqueos-horario
   * HE08-HU-03 / HE08-HU-05: crea un bloqueo para el barbero autenticado.
   *
   * Nota: la verificación de reservas activas (HE-04) todavía no está
   * integrada. Mientras no lo esté, la creación falla cerrada con 503 en lugar
   * de omitir la regla SCHEDULE_BLOCK_HAS_RESERVATIONS.
   */
  @Post('bloqueos-horario')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Crea un bloqueo de horario del barbero autenticado',
    description:
      'Valida fecha y horas, que el rango esté dentro del horario semanal del día, que se componga de franjas de 60 minutos, que no se solape con otro bloqueo activo ni con un cierre general. La verificación de reservas (HE-04) no está integrada: por ahora responde 503 salvo que el proveedor esté disponible.',
  })
  @ApiBody({ type: CrearBloqueoHorarioDto })
  @ApiCreatedResponse({
    description: 'Bloqueo creado correctamente.',
    type: BloqueoHorarioAccionResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Fecha u horas inválidas, rango fuera de la jornada o del horario semanal, duración no divisible en bloques de 60 minutos, o solapamiento con otro bloqueo/cierre (400).',
  })
  @ApiUnauthorizedResponse({ description: 'No autenticado.' })
  @ApiForbiddenResponse({
    description:
      'El usuario autenticado no tiene un perfil de barbero asociado.',
  })
  @ApiConflictResponse({
    description:
      'El rango contiene una reserva no cancelada (SCHEDULE_BLOCK_HAS_RESERVATIONS).',
  })
  @ApiServiceUnavailableResponse({
    description:
      'La verificación de reservas activas (HE-04) no está integrada; la creación se rechaza para no omitir la regla.',
  })
  async crearBloqueo(
    @Req() request: RequestConUsuario,
    @Body() dto: CrearBloqueoHorarioDto,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    return this.bloqueosHorarioService.crearBloqueo(request.user, dto);
  }

  /**
   * GET /usuarios/me/barbero/bloqueos-horario
   * Lista los bloqueos del barbero autenticado con filtros opcionales.
   */
  @Get('bloqueos-horario')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Lista los bloqueos del barbero autenticado',
  })
  @ApiOkResponse({
    description: 'Lista de bloqueos del barbero autenticado.',
    type: [BloqueoHorarioResponseDto],
  })
  @ApiBadRequestResponse({
    description: 'Filtros inválidos (fecha o estado con formato incorrecto).',
  })
  @ApiUnauthorizedResponse({ description: 'No autenticado.' })
  @ApiForbiddenResponse({
    description:
      'El usuario autenticado no tiene un perfil de barbero asociado.',
  })
  async listarBloqueos(
    @Req() request: RequestConUsuario,
    @Query() filtro: FiltroBloqueosHorarioDto,
  ): Promise<BloqueoHorarioResponseDto[]> {
    return this.bloqueosHorarioService.listarBloqueos(request.user, filtro);
  }

  /**
   * PATCH /usuarios/me/barbero/bloqueos-horario/:id
   * HE08-HU-03 / HE08-HU-05: modifica parcialmente un bloqueo `ACTIVE`.
   */
  @Patch('bloqueos-horario/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Modifica parcialmente un bloqueo del barbero autenticado',
    description:
      'Solo edita bloqueos ACTIVE. Si cambia la fecha u horas, revalida horario semanal, solapamientos, cierres y reservas antes de persistir.',
  })
  @ApiParam({ name: 'id', example: 1, description: 'ID del bloqueo' })
  @ApiBody({ type: ActualizarBloqueoHorarioDto })
  @ApiOkResponse({
    description: 'Bloqueo actualizado correctamente.',
    type: BloqueoHorarioAccionResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, rango fuera de horario, duración incorrecta o solapamiento.',
  })
  @ApiUnauthorizedResponse({ description: 'No autenticado.' })
  @ApiForbiddenResponse({
    description:
      'El usuario autenticado no tiene un perfil de barbero asociado.',
  })
  @ApiNotFoundResponse({
    description: 'El bloqueo no existe o no pertenece al barbero autenticado.',
  })
  @ApiConflictResponse({
    description:
      'El bloqueo no está ACTIVE (transición inválida) o el rango contiene una reserva no cancelada.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'La verificación de reservas activas (HE-04) no está integrada; el cambio de horario se rechaza para no omitir la regla.',
  })
  async actualizarBloqueo(
    @Req() request: RequestConUsuario,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarBloqueoHorarioDto,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    return this.bloqueosHorarioService.actualizarBloqueo(request.user, id, dto);
  }

  /**
   * DELETE /usuarios/me/barbero/bloqueos-horario/:id
   * HE08-HU-05: cancela lógicamente un bloqueo (`CANCELLED`), sin borrar la fila.
   */
  @Delete('bloqueos-horario/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Cancela lógicamente un bloqueo del barbero autenticado',
    description:
      'Cambia el estado a CANCELLED. No borra el registro ni el historial.',
  })
  @ApiParam({ name: 'id', example: 1, description: 'ID del bloqueo' })
  @ApiOkResponse({
    description: 'Bloqueo cancelado correctamente.',
    type: BloqueoHorarioAccionResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'No autenticado.' })
  @ApiForbiddenResponse({
    description:
      'El usuario autenticado no tiene un perfil de barbero asociado.',
  })
  @ApiNotFoundResponse({
    description: 'El bloqueo no existe o no pertenece al barbero autenticado.',
  })
  @ApiConflictResponse({
    description: 'El bloqueo no está ACTIVE (transición inválida).',
  })
  async cancelarBloqueo(
    @Req() request: RequestConUsuario,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    return this.bloqueosHorarioService.cancelarBloqueo(request.user, id);
  }

  /**
   * PATCH /usuarios/me/barbero/bloqueos-horario/:id/reactivar
   * HE08-HU-06: reactiva/libera lógicamente un bloqueo (`ACTIVE -> REACTIVATED`).
   */
  @Patch('bloqueos-horario/:id/reactivar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Reactiva/libera un bloqueo del barbero autenticado',
    description:
      'Solo permite la transición ACTIVE -> REACTIVATED y registra reactivatedAt/reactivatedBy. Conserva el historial y no borra el registro.',
  })
  @ApiParam({ name: 'id', example: 1, description: 'ID del bloqueo' })
  @ApiOkResponse({
    description: 'Bloqueo reactivado correctamente.',
    type: BloqueoHorarioAccionResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'No autenticado.' })
  @ApiForbiddenResponse({
    description:
      'El usuario autenticado no tiene un perfil de barbero asociado.',
  })
  @ApiNotFoundResponse({
    description: 'El bloqueo no existe o no pertenece al barbero autenticado.',
  })
  @ApiConflictResponse({
    description: 'El bloqueo no está ACTIVE (transición inválida).',
  })
  async reactivarBloqueo(
    @Req() request: RequestConUsuario,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    return this.bloqueosHorarioService.reactivarBloqueo(request.user, id);
  }
}

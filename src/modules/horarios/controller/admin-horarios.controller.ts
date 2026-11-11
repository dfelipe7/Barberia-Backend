import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
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
import { HorarioSemanalService } from '../service/horario-semanal.service';
import { BloqueosHorarioService } from '../service/bloqueos-horario.service';
import { ReemplazarHorarioSemanalDto } from '../dto/dto-peticion/reemplazar-horario-semanal.dto';
import { HorarioSemanalResponseDto } from '../dto/dto-respuesta/horario-semanal-response.dto';
import { CrearBloqueoHorarioDto } from '../dto/dto-peticion/crear-bloqueo-horario.dto';
import { ActualizarBloqueoHorarioDto } from '../dto/dto-peticion/actualizar-bloqueo-horario.dto';
import { FiltroBloqueosHorarioDto } from '../dto/dto-peticion/filtro-bloqueos-horario.dto';
import {
  BloqueoHorarioAccionResponseDto,
  BloqueoHorarioResponseDto,
} from '../dto/dto-respuesta/bloqueo-horario-response.dto';

import { ClaimsSesionPersonal } from '../../../auth/sesion/sesion-personal';

/** Petición HTTP con claims de usuario autenticado en la administración de horarios. */
export interface RequestConUsuario {
  user?: Partial<ClaimsSesionPersonal>;
}

/**
 * Controlador de Administración de Horarios y Bloqueos de Barberos.
 *
 * @remarks
 * Exclusivo para administradores de sede (`SUPERADMIN`):
 * Permite definir, reemplazar y auditar los horarios semanales de trabajo y los bloqueos temporales
 * de agenda para cualquier barbero de la sede activa.
 */
@ApiTags('Horarios - Administración')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@Controller('usuarios/barberos')
export class AdminHorariosController {
  constructor(
    private readonly horarioSemanalService: HorarioSemanalService,
    private readonly bloqueosHorarioService: BloqueosHorarioService,
  ) {}

  @Get(':barberoId/horario-semanal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consultar el horario semanal de cualquier barbero (SUPERADMIN)',
    description:
      'Obtiene las franjas activas del horario semanal del barbero identificado por barberoId.',
  })
  @ApiParam({
    name: 'barberoId',
    example: 2,
    description: 'ID del barbero objetivo',
  })
  @ApiOkResponse({
    description: 'Horario semanal vigente del barbero.',
    type: HorarioSemanalResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'El barbero especificado no existe o no está activo.',
  })
  @ApiUnauthorizedResponse({ description: 'No autenticado o token inválido.' })
  @ApiForbiddenResponse({ description: 'Acceso restringido a SUPERADMIN.' })
  async obtenerHorarioSemanal(
    @Param('barberoId', ParseIntPipe) barberoId: number,
  ): Promise<HorarioSemanalResponseDto> {
    return this.horarioSemanalService.obtenerHorarioSemanalDeBarbero(barberoId);
  }

  @Put(':barberoId/horario-semanal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reemplazar el horario semanal de cualquier barbero (SUPERADMIN)',
    description:
      'Actualiza de forma completa el horario semanal del barbero objetivo. Rechaza la operación si alguna franja reducida o eliminada colisiona con reservas no canceladas.',
  })
  @ApiParam({
    name: 'barberoId',
    example: 2,
    description: 'ID del barbero objetivo',
  })
  @ApiBody({ type: ReemplazarHorarioSemanalDto })
  @ApiOkResponse({
    description: 'Horario semanal actualizado correctamente.',
    type: HorarioSemanalResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Franjas inválidas o formato incorrecto.',
  })
  @ApiNotFoundResponse({
    description: 'El barbero especificado no existe o no está activo.',
  })
  @ApiConflictResponse({
    description:
      'Una franja modificada contiene reservas activas (SCHEDULE_CHANGE_AFFECTS_RESERVATIONS).',
  })
  @ApiServiceUnavailableResponse({
    description: 'El proveedor de reservas no está disponible (fail-closed).',
  })
  @ApiForbiddenResponse({ description: 'Acceso restringido a SUPERADMIN.' })
  async reemplazarHorarioSemanal(
    @Param('barberoId', ParseIntPipe) barberoId: number,
    @Body() dto: ReemplazarHorarioSemanalDto,
  ): Promise<HorarioSemanalResponseDto> {
    return this.horarioSemanalService.reemplazarHorarioSemanalDeBarbero(
      barberoId,
      dto,
    );
  }

  @Get(':barberoId/bloqueos-horario')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listar bloqueos de horario de cualquier barbero (SUPERADMIN)',
    description:
      'Lista los periodos de no disponibilidad y bloqueos temporales del barbero objetivo.',
  })
  @ApiParam({
    name: 'barberoId',
    example: 2,
    description: 'ID del barbero objetivo',
  })
  @ApiOkResponse({
    description: 'Listado de bloqueos de horario del barbero.',
    type: [BloqueoHorarioResponseDto],
  })
  @ApiNotFoundResponse({
    description: 'El barbero especificado no existe o no está activo.',
  })
  @ApiForbiddenResponse({ description: 'Acceso restringido a SUPERADMIN.' })
  async listarBloqueos(
    @Param('barberoId', ParseIntPipe) barberoId: number,
    @Query() filtro: FiltroBloqueosHorarioDto,
  ): Promise<BloqueoHorarioResponseDto[]> {
    return this.bloqueosHorarioService.listarBloqueosDeBarbero(
      barberoId,
      filtro,
    );
  }

  @Post(':barberoId/bloqueos-horario')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear un bloqueo de horario para cualquier barbero (SUPERADMIN)',
    description:
      'Registra un bloqueo temporal ACTIVE validando horario semanal, ausencia de solapamientos, cierres generales y ausencia de reservas activas.',
  })
  @ApiParam({
    name: 'barberoId',
    example: 2,
    description: 'ID del barbero objetivo',
  })
  @ApiBody({ type: CrearBloqueoHorarioDto })
  @ApiCreatedResponse({
    description: 'Bloqueo creado correctamente.',
    type: BloqueoHorarioAccionResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o fuera del horario semanal del barbero.',
  })
  @ApiNotFoundResponse({
    description: 'El barbero especificado no existe o no está activo.',
  })
  @ApiConflictResponse({
    description: 'El rango contiene una reserva no cancelada.',
  })
  @ApiServiceUnavailableResponse({
    description: 'El proveedor de reservas no está disponible (fail-closed).',
  })
  @ApiForbiddenResponse({ description: 'Acceso restringido a SUPERADMIN.' })
  async crearBloqueo(
    @Param('barberoId', ParseIntPipe) barberoId: number,
    @Body() dto: CrearBloqueoHorarioDto,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    return this.bloqueosHorarioService.crearBloqueoDeBarbero(barberoId, dto);
  }

  @Patch(':barberoId/bloqueos-horario/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Modificar un bloqueo de horario de cualquier barbero (SUPERADMIN)',
    description:
      'Actualiza parcialmente un bloqueo ACTIVE del barbero objetivo.',
  })
  @ApiParam({
    name: 'barberoId',
    example: 2,
    description: 'ID del barbero objetivo',
  })
  @ApiParam({
    name: 'id',
    example: 10,
    description: 'ID del bloqueo a modificar',
  })
  @ApiBody({ type: ActualizarBloqueoHorarioDto })
  @ApiOkResponse({
    description: 'Bloqueo actualizado correctamente.',
    type: BloqueoHorarioAccionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'El barbero o el bloqueo no existe.' })
  @ApiConflictResponse({
    description:
      'El bloqueo no está ACTIVE o el nuevo horario colisiona con reservas.',
  })
  @ApiForbiddenResponse({ description: 'Acceso restringido a SUPERADMIN.' })
  async actualizarBloqueo(
    @Param('barberoId', ParseIntPipe) barberoId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarBloqueoHorarioDto,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    return this.bloqueosHorarioService.actualizarBloqueoDeBarbero(
      barberoId,
      id,
      dto,
    );
  }

  @Delete(':barberoId/bloqueos-horario/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancelar un bloqueo de horario de cualquier barbero (SUPERADMIN)',
    description:
      'Transiciona el bloqueo a CANCELLED sin borrar el registro ni el historial.',
  })
  @ApiParam({
    name: 'barberoId',
    example: 2,
    description: 'ID del barbero objetivo',
  })
  @ApiParam({
    name: 'id',
    example: 10,
    description: 'ID del bloqueo a cancelar',
  })
  @ApiOkResponse({
    description: 'Bloqueo cancelado correctamente.',
    type: BloqueoHorarioAccionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'El barbero o el bloqueo no existe.' })
  @ApiConflictResponse({ description: 'El bloqueo no está ACTIVE.' })
  @ApiForbiddenResponse({ description: 'Acceso restringido a SUPERADMIN.' })
  async cancelarBloqueo(
    @Param('barberoId', ParseIntPipe) barberoId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    return this.bloqueosHorarioService.cancelarBloqueoDeBarbero(barberoId, id);
  }

  @Patch(':barberoId/bloqueos-horario/:id/reactivar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Reactivar/liberar un bloqueo de horario de cualquier barbero (SUPERADMIN)',
    description:
      'Transiciona el bloqueo a REACTIVATED registrando la auditoría de reactivación.',
  })
  @ApiParam({
    name: 'barberoId',
    example: 2,
    description: 'ID del barbero objetivo',
  })
  @ApiParam({
    name: 'id',
    example: 10,
    description: 'ID del bloqueo a reactivar',
  })
  @ApiOkResponse({
    description: 'Bloqueo reactivado correctamente.',
    type: BloqueoHorarioAccionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'El barbero o el bloqueo no existe.' })
  @ApiConflictResponse({ description: 'El bloqueo no está ACTIVE.' })
  @ApiForbiddenResponse({ description: 'Acceso restringido a SUPERADMIN.' })
  async reactivarBloqueo(
    @Param('barberoId', ParseIntPipe) barberoId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() request: RequestConUsuario,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    return this.bloqueosHorarioService.reactivarBloqueoDeBarbero(
      barberoId,
      id,
      request?.user,
    );
  }
}

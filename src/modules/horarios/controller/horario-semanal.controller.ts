import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { HorarioSemanalService } from '../service/horario-semanal.service';
import { ReemplazarHorarioSemanalDto } from '../dto/dto-peticion/reemplazar-horario-semanal.dto';
import { HorarioSemanalResponseDto } from '../dto/dto-respuesta/horario-semanal-response.dto';

@ApiTags('Horarios')
@ApiBearerAuth()
@Controller('usuarios/me/barbero')
export class HorarioSemanalController {
  constructor(private readonly horarioSemanalService: HorarioSemanalService) {}

  /**
   * GET /usuarios/me/barbero/horario-semanal
   * HE08-HU-01: Consulta el horario semanal del barbero autenticado.
   */
  @Get('horario-semanal')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Obtiene el horario semanal del barbero autenticado',
  })
  @ApiOkResponse({
    description: 'Horario semanal vigente del barbero autenticado.',
    type: HorarioSemanalResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'No autenticado.' })
  @ApiForbiddenResponse({
    description:
      'El usuario autenticado no tiene un perfil de barbero asociado.',
  })
  async obtenerMiHorarioSemanal(@Req() request: any) {
    return this.horarioSemanalService.obtenerMiHorarioSemanal(request.user);
  }

  /**
   * PUT /usuarios/me/barbero/horario-semanal
   * HE08-HU-02: Reemplaza por completo el horario semanal del barbero autenticado.
   *
   * Agregar franjas siempre está permitido. Eliminar, reducir o mover una franja
   * existente se permite solo si esa franja no contiene reservas no canceladas;
   * la verificación se delega en el proveedor de reservas (HE-04). Mientras ese
   * proveedor no esté integrado, la operación falla de forma cerrada (503).
   */
  @Put('horario-semanal')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Reemplaza el horario semanal del barbero autenticado',
    description:
      'La lista enviada pasa a ser el horario semanal vigente. Se permite eliminar, reducir o mover franjas siempre que no contengan reservas no canceladas; si las contienen devuelve 409 (SCHEDULE_CHANGE_AFFECTS_RESERVATIONS). Si la verificación de reservas (HE-04) no está integrada, responde 503 en lugar de asumir que no hay reservas.',
  })
  @ApiBody({ type: ReemplazarHorarioSemanalDto })
  @ApiOkResponse({
    description: 'Horario semanal actualizado correctamente.',
    type: HorarioSemanalResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Franjas inválidas: formato incorrecto, fuera de la jornada, duración distinta de 60 minutos, duplicadas o solapadas.',
  })
  @ApiConflictResponse({
    description:
      'Una franja que se elimina, reduce o mueve contiene reservas no canceladas (SCHEDULE_CHANGE_AFFECTS_RESERVATIONS).',
  })
  @ApiServiceUnavailableResponse({
    description:
      'La verificación de reservas activas (HE-04) no está integrada; el cambio de horario se rechaza para no invalidar reservas.',
  })
  @ApiUnauthorizedResponse({ description: 'No autenticado.' })
  @ApiForbiddenResponse({
    description:
      'El usuario autenticado no tiene un perfil de barbero asociado.',
  })
  async reemplazarMiHorarioSemanal(
    @Req() request: any,
    @Body() dto: ReemplazarHorarioSemanalDto,
  ) {
    return this.horarioSemanalService.reemplazarMiHorarioSemanal(
      request.user,
      dto,
    );
  }
}

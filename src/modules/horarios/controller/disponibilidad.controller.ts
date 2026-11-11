import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DisponibilidadService } from '../service/disponibilidad.service';
import { ConsultaDisponibilidadDto } from '../dto/dto-peticion/consulta-disponibilidad.dto';
import { DisponibilidadPublicaResponseDto } from '../dto/dto-respuesta/disponibilidad-response.dto';
import { ApiNegocioHeader } from '../../../common/decorators/api-negocio-header.decorator';

/**
 * Endpoint público de disponibilidad (spec §9.8): no requiere autenticación,
 * igual que los catálogos `/usuarios/barberos` y `/servicios`.
 *
 * El controller no aplica reglas: solo construye la consulta y delega en la
 * fachada `DisponibilidadService`. La vista pública nunca revela reservas,
 * bloqueos ni cierres.
 */
@ApiTags('Disponibilidad')
@Controller('usuarios/barberos')
export class DisponibilidadController {
  constructor(private readonly disponibilidadService: DisponibilidadService) {}

  /**
   * GET /usuarios/barberos/:barberoId/disponibilidad?servicioId=&fecha=
   */
  @Get(':barberoId/disponibilidad')
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Consulta pública de disponibilidad de un barbero',
    description:
      'Endpoint PÚBLICO (sin autenticación). El `barberoId` es el Barbero.id (el mismo que devuelve el catálogo). Solo se consultan horarios, bloqueos y cierres de la barbería de la petición: un barbero de otra barbería responde 404.',
  })
  @ApiParam({
    name: 'barberoId',
    example: 3,
    description: 'ID del barbero (Barbero.id)',
  })
  @ApiOkResponse({
    description: 'Franjas disponibles de la jornada.',
    type: DisponibilidadPublicaResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Fecha inválida (formato o día inexistente) o servicio no asignado al barbero.',
  })
  @ApiNotFoundResponse({
    description: 'El barbero o el servicio no existe o no está activo.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'La verificación de reservas activas (HE-04) no está integrada; la consulta se rechaza para no anunciar franjas potencialmente ocupadas.',
  })
  /**
   * Consulta pública de franjas horarias disponibles para reserva de un barbero.
   *
   * @param barberoId - Identificador numérico del barbero (`Barbero.id`).
   * @param query - Parámetros de consulta (servicioId, fecha en formato YYYY-MM-DD).
   * @returns Listado de franjas de inicio de cita disponibles (`DisponibilidadPublicaResponseDto`).
   * @throws {NotFoundException} Si el barbero o servicio no existen o están inactivos.
   * @throws {BadRequestException} Si la fecha o el servicio son inválidos.
   */
  async consultarDisponibilidadPublica(
    @Param('barberoId', ParseIntPipe) barberoId: number,
    @Query() consulta: ConsultaDisponibilidadDto,
  ): Promise<DisponibilidadPublicaResponseDto> {
    return this.disponibilidadService.obtenerDisponibilidadPublica({
      barberoId,
      servicioId: consulta.servicioId,
      fecha: consulta.fecha,
    });
  }
}

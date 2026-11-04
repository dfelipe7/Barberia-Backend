import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { DisponibilidadService } from '../service/disponibilidad.service';
import { ConsultaDisponibilidadDto } from '../dto/dto-peticion/consulta-disponibilidad.dto';
import { DisponibilidadDetalladaResponseDto } from '../dto/dto-respuesta/disponibilidad-response.dto';

import { ClaimsSesionPersonal } from '../../../auth/sesion/sesion-personal';

interface RequestConUsuario {
  user?: Partial<ClaimsSesionPersonal>;
}

/**
 * Consulta de disponibilidad detallada del barbero autenticado.
 *
 * A diferencia de la vista pública, expone el estado de cada franja
 * (AVAILABLE, RESERVED, BLOCKED, GENERAL_CLOSURE, OUTSIDE_SCHEDULE) para que el
 * propio barbero entienda su agenda. La identidad se resuelve desde el token.
 */
@ApiTags('Disponibilidad')
@ApiBearerAuth()
@Controller('usuarios/me/barbero')
export class DisponibilidadBarberoController {
  constructor(private readonly disponibilidadService: DisponibilidadService) {}

  /**
   * GET /usuarios/me/barbero/disponibilidad?servicioId=&fecha=
   */
  @Get('disponibilidad')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Consulta detallada de la propia disponibilidad del barbero',
    description:
      'Devuelve el estado efectivo de cada franja del barbero autenticado. Reservado al propio barbero; los estados no se exponen en el endpoint público.',
  })
  @ApiOkResponse({
    description: 'Franjas de la jornada con su estado efectivo.',
    type: DisponibilidadDetalladaResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Fecha inválida (formato o día inexistente) o servicio no asignado al barbero.',
  })
  @ApiUnauthorizedResponse({ description: 'No autenticado.' })
  @ApiForbiddenResponse({
    description:
      'El usuario autenticado no tiene un perfil de barbero asociado.',
  })
  @ApiNotFoundResponse({
    description: 'El servicio no existe o no está activo.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'La verificación de reservas activas (HE-04) no está integrada; la consulta se rechaza para no anunciar franjas potencialmente ocupadas.',
  })
  async consultarMiDisponibilidad(
    @Req() request: RequestConUsuario,
    @Query() consulta: ConsultaDisponibilidadDto,
  ): Promise<DisponibilidadDetalladaResponseDto> {
    return this.disponibilidadService.obtenerDisponibilidadDetalladaDelBarberoAutenticado(
      request.user,
      { servicioId: consulta.servicioId, fecha: consulta.fecha },
    );
  }
}

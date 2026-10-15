import { Injectable } from '@nestjs/common';
import { EstadoFranja } from '../common/estado-franja';
import type { FranjaEvaluada } from '../common/estado-franja';
import { ZONA_HORARIA_BOGOTA } from '../common/fecha-bogota.service';
import type { ConsultaDisponibilidad } from '../common/consulta-disponibilidad';
import {
  DisponibilidadDetalladaResponseDto,
  DisponibilidadPublicaResponseDto,
  FranjaDisponibilidadDetalladaDto,
  FranjaDisponibleDto,
} from '../dto/dto-respuesta/disponibilidad-response.dto';

/**
 * Mapeador de la disponibilidad resuelta (`FranjaEvaluada[]`) a los DTOs de
 * respuesta.
 *
 * La vista pública filtra las franjas `AVAILABLE` y descarta cualquier motivo de
 * indisponibilidad, de modo que la privacidad de reservas, bloqueos y cierres no
 * dependa del controller.
 */
@Injectable()
export class DisponibilidadMapper {
  aPublica(
    consulta: ConsultaDisponibilidad,
    franjas: FranjaEvaluada[],
  ): DisponibilidadPublicaResponseDto {
    const slots: FranjaDisponibleDto[] = franjas
      .filter((franja) => franja.estado === EstadoFranja.AVAILABLE)
      .map((franja) => ({
        startTime: franja.startTime,
        endTime: franja.endTime,
        available: true,
      }));

    return {
      fecha: consulta.fecha,
      timeZone: ZONA_HORARIA_BOGOTA,
      barberoId: consulta.barberoId,
      servicioId: consulta.servicioId ?? null,
      slots,
    };
  }

  aDetallada(
    consulta: ConsultaDisponibilidad,
    franjas: FranjaEvaluada[],
  ): DisponibilidadDetalladaResponseDto {
    const slots: FranjaDisponibilidadDetalladaDto[] = franjas.map((franja) => ({
      startTime: franja.startTime,
      endTime: franja.endTime,
      status: franja.estado,
    }));

    return {
      fecha: consulta.fecha,
      timeZone: ZONA_HORARIA_BOGOTA,
      barberoId: consulta.barberoId,
      servicioId: consulta.servicioId ?? null,
      slots,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { EstadoFranja } from '../common/estado-franja';
import type { FranjaHorario } from '../factory/franja.factory';
import { ORDEN_REGLAS_DISPONIBILIDAD } from './regla-disponibilidad.strategy';
import type {
  ContextoDisponibilidad,
  ReglaDisponibilidad,
} from './regla-disponibilidad.strategy';

/**
 * Regla de horario semanal: una franja que no pertenece al horario activo del
 * barbero para ese día queda `OUTSIDE_SCHEDULE`. Es la primera regla en
 * evaluarse: si no hay horario, nada más importa.
 */
@Injectable()
export class HorarioSemanalRule implements ReglaDisponibilidad {
  readonly orden = ORDEN_REGLAS_DISPONIBILIDAD.HORARIO_SEMANAL;

  evaluar(
    franja: FranjaHorario,
    contexto: ContextoDisponibilidad,
  ): EstadoFranja | null {
    const dentroDelHorario = contexto.franjasHorario.some(
      (franjaHorario) => franjaHorario.startTime === franja.startTime,
    );

    return dentroDelHorario ? null : EstadoFranja.OUTSIDE_SCHEDULE;
  }
}

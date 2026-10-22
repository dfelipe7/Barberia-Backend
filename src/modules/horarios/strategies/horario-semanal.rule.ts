import { Injectable } from '@nestjs/common';
import { EstadoFranja } from '../common/estado-franja';
import type { FranjaHorario } from '../factory/franja.factory';
import { ORDEN_REGLAS_DISPONIBILIDAD } from './regla-disponibilidad.strategy';
import type {
  ContextoDisponibilidad,
  ReglaDisponibilidad,
} from './regla-disponibilidad.strategy';
import { estaFueraDelHorarioSemanal } from './reglas-disponibilidad-puras';

/**
 * Regla de horario semanal: una franja que no pertenece al horario activo del
 * barbero para ese día queda `OUTSIDE_SCHEDULE`. Es la primera regla en
 * evaluarse: si no hay horario, nada más importa.
 *
 * El predicado es el MISMO que usa la revalidación transaccional de la
 * reserva (`reglas-disponibilidad-puras`): no hay dos criterios de horario.
 */
@Injectable()
export class HorarioSemanalRule implements ReglaDisponibilidad {
  readonly orden = ORDEN_REGLAS_DISPONIBILIDAD.HORARIO_SEMANAL;

  evaluar(
    franja: FranjaHorario,
    contexto: ContextoDisponibilidad,
  ): EstadoFranja | null {
    const dentroDelHorario = !estaFueraDelHorarioSemanal(
      franja,
      contexto.franjasHorario,
    );

    return dentroDelHorario ? null : EstadoFranja.OUTSIDE_SCHEDULE;
  }
}

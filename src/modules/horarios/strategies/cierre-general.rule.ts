import { Injectable } from '@nestjs/common';
import { EstadoFranja } from '../common/estado-franja';
import { FranjaFactory } from '../factory/franja.factory';
import type { FranjaHorario } from '../factory/franja.factory';
import { ORDEN_REGLAS_DISPONIBILIDAD } from './regla-disponibilidad.strategy';
import type {
  ContextoDisponibilidad,
  ReglaDisponibilidad,
} from './regla-disponibilidad.strategy';
import { estaCubiertaPorCierreGeneral } from './reglas-disponibilidad-puras';

/**
 * Regla de cierre general: cualquier franja alcanzada por un cierre activo del
 * día queda `GENERAL_CLOSURE`. Un cierre `allDay` cubre todo el día; uno parcial
 * se compara por intervalos `[inicio, fin)`. Prevalece sobre el horario semanal.
 *
 * El predicado es el MISMO que usa la revalidación transaccional de la
 * reserva (`reglas-disponibilidad-puras`).
 */
@Injectable()
export class CierreGeneralRule implements ReglaDisponibilidad {
  readonly orden = ORDEN_REGLAS_DISPONIBILIDAD.CIERRE_GENERAL;

  constructor(private readonly franjaFactory: FranjaFactory) {}

  evaluar(
    franja: FranjaHorario,
    contexto: ContextoDisponibilidad,
  ): EstadoFranja | null {
    const alcanzada = estaCubiertaPorCierreGeneral(
      franja,
      contexto.cierresActivos,
    );

    return alcanzada ? EstadoFranja.GENERAL_CLOSURE : null;
  }
}

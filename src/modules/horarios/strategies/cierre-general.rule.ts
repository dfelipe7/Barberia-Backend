import { Injectable } from '@nestjs/common';
import { EstadoFranja } from '../common/estado-franja';
import { FranjaFactory } from '../factory/franja.factory';
import type { FranjaHorario } from '../factory/franja.factory';
import { ORDEN_REGLAS_DISPONIBILIDAD } from './regla-disponibilidad.strategy';
import type {
  ContextoDisponibilidad,
  ReglaDisponibilidad,
} from './regla-disponibilidad.strategy';

/**
 * Regla de cierre general: cualquier franja alcanzada por un cierre activo del
 * día queda `GENERAL_CLOSURE`. Un cierre `allDay` cubre todo el día; uno parcial
 * se compara por intervalos `[inicio, fin)`. Prevalece sobre el horario semanal.
 */
@Injectable()
export class CierreGeneralRule implements ReglaDisponibilidad {
  readonly orden = ORDEN_REGLAS_DISPONIBILIDAD.CIERRE_GENERAL;

  constructor(private readonly franjaFactory: FranjaFactory) {}

  evaluar(
    franja: FranjaHorario,
    contexto: ContextoDisponibilidad,
  ): EstadoFranja | null {
    const inicioFranja = this.franjaFactory.aMinutos(franja.startTime);
    const finFranja = this.franjaFactory.aMinutos(franja.endTime);

    const alcanzada = contexto.cierresActivos.some((cierre) => {
      if (cierre.allDay) {
        return true;
      }
      if (!cierre.startTime || !cierre.endTime) {
        return false;
      }

      const inicioCierre = this.franjaFactory.aMinutos(cierre.startTime);
      const finCierre = this.franjaFactory.aMinutos(cierre.endTime);
      return inicioCierre < finFranja && finCierre > inicioFranja;
    });

    return alcanzada ? EstadoFranja.GENERAL_CLOSURE : null;
  }
}

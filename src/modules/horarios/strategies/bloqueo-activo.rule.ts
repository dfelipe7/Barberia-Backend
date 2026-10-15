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
 * Regla de bloqueo activo: una franja solapada por un bloqueo `ACTIVE` del
 * barbero en la fecha queda `BLOCKED`. Los bloqueos `REACTIVATED` y `CANCELLED`
 * no llegan a este contexto porque la consulta solo recupera los activos.
 */
@Injectable()
export class BloqueoActivoRule implements ReglaDisponibilidad {
  readonly orden = ORDEN_REGLAS_DISPONIBILIDAD.BLOQUEO_ACTIVO;

  constructor(private readonly franjaFactory: FranjaFactory) {}

  evaluar(
    franja: FranjaHorario,
    contexto: ContextoDisponibilidad,
  ): EstadoFranja | null {
    const inicioFranja = this.franjaFactory.aMinutos(franja.startTime);
    const finFranja = this.franjaFactory.aMinutos(franja.endTime);

    const solapada = contexto.bloqueosActivos.some((bloqueo) => {
      const inicioBloqueo = this.franjaFactory.aMinutos(bloqueo.startTime);
      const finBloqueo = this.franjaFactory.aMinutos(bloqueo.endTime);
      return inicioBloqueo < finFranja && finBloqueo > inicioFranja;
    });

    return solapada ? EstadoFranja.BLOCKED : null;
  }
}

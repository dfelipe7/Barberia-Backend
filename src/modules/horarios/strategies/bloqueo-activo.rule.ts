import { Injectable } from '@nestjs/common';
import { EstadoFranja } from '../common/estado-franja';
import { FranjaFactory } from '../factory/franja.factory';
import type { FranjaHorario } from '../factory/franja.factory';
import { ORDEN_REGLAS_DISPONIBILIDAD } from './regla-disponibilidad.strategy';
import type {
  ContextoDisponibilidad,
  ReglaDisponibilidad,
} from './regla-disponibilidad.strategy';
import { estaCubiertaPorBloqueo } from './reglas-disponibilidad-puras';

/**
 * Regla de bloqueo activo: una franja solapada por un bloqueo `ACTIVE` del
 * barbero en la fecha queda `BLOCKED`. Los bloqueos `REACTIVATED` y `CANCELLED`
 * no llegan a este contexto porque la consulta solo recupera los activos.
 *
 * El predicado es el MISMO que usa la revalidación transaccional de la
 * reserva (`reglas-disponibilidad-puras`).
 */
@Injectable()
export class BloqueoActivoRule implements ReglaDisponibilidad {
  readonly orden = ORDEN_REGLAS_DISPONIBILIDAD.BLOQUEO_ACTIVO;

  constructor(private readonly franjaFactory: FranjaFactory) {}

  evaluar(
    franja: FranjaHorario,
    contexto: ContextoDisponibilidad,
  ): EstadoFranja | null {
    const solapada = estaCubiertaPorBloqueo(franja, contexto.bloqueosActivos);

    return solapada ? EstadoFranja.BLOCKED : null;
  }
}

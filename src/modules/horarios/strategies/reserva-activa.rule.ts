import { Inject, Injectable } from '@nestjs/common';
import { EstadoFranja } from '../common/estado-franja';
import type { FranjaHorario } from '../factory/franja.factory';
import { ORDEN_REGLAS_DISPONIBILIDAD } from './regla-disponibilidad.strategy';
import type {
  ContextoDisponibilidad,
  ReglaDisponibilidad,
} from './regla-disponibilidad.strategy';
import { PROVEEDOR_RESERVAS_ACTIVAS } from '../ports/proveedor-reservas-activas.port';
import type { ProveedorReservasActivas } from '../ports/proveedor-reservas-activas.port';

/**
 * Regla de reserva activa: una franja que contiene una reserva no cancelada
 * queda `RESERVED`. Es la última regla y la única asíncrona: delega en el puerto
 * `ProveedorReservasActivas` de HE-04.
 *
 * Mientras HE-04 no esté integrado, el proveedor rechaza con
 * `ReservasNoDisponiblesError`, que la fachada traduce a 503 (fail-closed). No
 * se captura aquí para que la disponibilidad nunca anuncie libre una franja
 * ocupada.
 */
@Injectable()
export class ReservaActivaRule implements ReglaDisponibilidad {
  readonly orden = ORDEN_REGLAS_DISPONIBILIDAD.RESERVA_ACTIVA;

  constructor(
    @Inject(PROVEEDOR_RESERVAS_ACTIVAS)
    private readonly proveedorReservas: ProveedorReservasActivas,
  ) {}

  async evaluar(
    franja: FranjaHorario,
    contexto: ContextoDisponibilidad,
  ): Promise<EstadoFranja | null> {
    const contieneReserva =
      await this.proveedorReservas.existeReservaNoCanceladaEnFranja({
        barberoId: contexto.barberoId,
        fecha: contexto.fecha,
        startTime: franja.startTime,
        endTime: franja.endTime,
      });

    return contieneReserva ? EstadoFranja.RESERVED : null;
  }
}

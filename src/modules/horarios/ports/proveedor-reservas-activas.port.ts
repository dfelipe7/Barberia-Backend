import { Injectable } from '@nestjs/common';

/**
 * Puerto de consulta de reservas activas (HE-04).
 *
 * HE-08 necesita saber si un rango de agenda contiene una reserva que todavía
 * ocupa la franja antes de crear o mover un bloqueo. La implementación real
 * pertenece a HE-04 y todavía no existe en este backend, por lo que se define
 * este contrato para:
 *
 * - No duplicar la lógica de reservas dentro de HE-08.
 * - Poder sustituir la implementación por la de HE-04 sin tocar el servicio de
 *   bloqueos (misma política de ocupación: `PENDING`, `CONFIRMED`,
 *   `IN_PROGRESS` y `COMPLETED` ocupan; `CANCELLED` libera).
 * - Fallar de forma cerrada (`fail-closed`) mientras la dependencia no esté
 *   disponible: la operación se rechaza explícitamente en lugar de omitir la
 *   verificación.
 */
export const PROVEEDOR_RESERVAS_ACTIVAS = Symbol('PROVEEDOR_RESERVAS_ACTIVAS');

/**
 * Consulta de conflicto sobre un rango concreto de un barbero en una fecha.
 * La fecha viaja como día de calendario (`YYYY-MM-DD`) para no arrastrar
 * desplazamientos de zona horaria.
 */
export interface ConsultaConflictoReserva {
  barberoId: number;
  fecha: string;
  startTime: string;
  endTime: string;
}

export interface ProveedorReservasActivas {
  /**
   * Indica si el rango `[startTime, endTime)` de un barbero en una fecha
   * contiene al menos una reserva cuyo estado no es `CANCELLED`.
   */
  existeReservaNoCanceladaEnFranja(
    consulta: ConsultaConflictoReserva,
  ): Promise<boolean>;
}

/**
 * Error de dominio que señala que el proveedor de reservas (HE-04) todavía no
 * está integrado. El servicio de bloqueos lo traduce a una respuesta HTTP
 * explícita (503) en vez de asumir que no hay reservas.
 */
export class ReservasNoDisponiblesError extends Error {
  constructor() {
    super(
      'La verificación de reservas activas (HE-04) todavía no está integrada en este backend',
    );
    this.name = 'ReservasNoDisponiblesError';
  }
}

/**
 * Implementación por defecto: HE-04 no está integrado, de modo que cualquier
 * consulta falla con `ReservasNoDisponiblesError`. Esto obliga al servicio de
 * bloqueos a rechazar la operación en lugar de omitir la regla de reservas.
 *
 * Cuando HE-04 esté disponible, se reemplaza este proveedor en el módulo sin
 * modificar el servicio de bloqueos.
 */
@Injectable()
export class ProveedorReservasActivasNoDisponible implements ProveedorReservasActivas {
  existeReservaNoCanceladaEnFranja(): Promise<boolean> {
    return Promise.reject(new ReservasNoDisponiblesError());
  }
}

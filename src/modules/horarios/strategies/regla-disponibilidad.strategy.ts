import type { FranjaHorario } from '../factory/franja.factory';
import type { EstadoFranja } from '../common/estado-franja';
import type { DiaSemana } from '../common/fecha-bogota.service';

/**
 * Token de inyección para el conjunto ordenado de reglas de disponibilidad.
 * La fachada `DisponibilidadService` las consume sin conocer implementaciones
 * concretas: solo su contrato y su prioridad.
 */
export const REGLAS_DISPONIBILIDAD = Symbol('REGLAS_DISPONIBILIDAD');

/**
 * Prioridad de evaluación de las reglas. Un valor menor se evalúa antes y, ante
 * empate, gana la primera regla que devuelva un estado. El orden materializa la
 * prelación del algoritmo: horario semanal, cierre general, bloqueo y reserva.
 */
export const ORDEN_REGLAS_DISPONIBILIDAD = {
  HORARIO_SEMANAL: 10,
  CIERRE_GENERAL: 20,
  BLOQUEO_ACTIVO: 30,
  RESERVA_ACTIVA: 40,
} as const;

/**
 * Datos precargados una sola vez por consulta y compartidos por todas las
 * reglas. Evita que cada regla vuelva a la base de datos por la misma fecha.
 */
export interface ContextoDisponibilidad {
  barberoId: number;
  /** Fecha de calendario `YYYY-MM-DD` (día de agenda). */
  fecha: string;
  diaSemana: DiaSemana;
  /** Franjas activas del horario semanal del barbero para ese día. */
  franjasHorario: Array<{ startTime: string }>;
  /** Bloqueos `ACTIVE` del barbero en esa fecha. */
  bloqueosActivos: Array<{ startTime: string; endTime: string }>;
  /** Cierres generales activos en esa fecha. */
  cierresActivos: Array<{
    allDay: boolean;
    startTime: string | null;
    endTime: string | null;
  }>;
  /** Reserva a excluir del cálculo de ocupación (al modificar una reserva propia). */
  excluirReservaId?: number;
}

/**
 * Contrato común de una regla de disponibilidad (patrón Strategy).
 *
 * Cada regla decide si una franja cae en su dominio; si no aplica devuelve
 * `null` para ceder el turno a la siguiente regla. Las reglas de dominio puro
 * son síncronas; la de reservas es asíncrona porque depende del puerto HE-04.
 */
export interface ReglaDisponibilidad {
  readonly orden: number;
  evaluar(
    franja: FranjaHorario,
    contexto: ContextoDisponibilidad,
  ): EstadoFranja | null | Promise<EstadoFranja | null>;
}

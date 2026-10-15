import { FranjaHorario } from '../factory/franja.factory';

/**
 * Estado efectivo de una franja horaria de HE-08.
 *
 * Es el vocabulario de dominio compartido por la fachada de disponibilidad y
 * por las reglas (strategies) que la componen. La prioridad de evaluación es
 * fija y descendente:
 *
 * `OUTSIDE_SCHEDULE` > `GENERAL_CLOSURE` > `BLOCKED` > `RESERVED` > `AVAILABLE`
 */
export const EstadoFranja = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  BLOCKED: 'BLOCKED',
  GENERAL_CLOSURE: 'GENERAL_CLOSURE',
  OUTSIDE_SCHEDULE: 'OUTSIDE_SCHEDULE',
} as const;

export type EstadoFranja = (typeof EstadoFranja)[keyof typeof EstadoFranja];

/**
 * Franja del catálogo diario con su estado de disponibilidad ya resuelto.
 * Es la salida de la fachada: la representación detallada que HE-04 consumirá
 * como fuente de verdad única.
 */
export interface FranjaEvaluada extends FranjaHorario {
  estado: EstadoFranja;
}

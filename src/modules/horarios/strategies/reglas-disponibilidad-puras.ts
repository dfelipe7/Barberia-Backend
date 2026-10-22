import type { FranjaHorario } from '../factory/franja.factory';

/**
 * Predicados PUROS de disponibilidad (HE-08).
 *
 * Se extraen de las reglas (`strategies/`) para que la MISMA decisión de
 * dominio pueda evaluarse en dos sitios distintos:
 *
 * - La fachada `DisponibilidadService`, que informa al cliente de las franjas
 *   libres.
 * - La REVALIDACIÓN dentro de la transacción de creación de la reserva, que
 *   vuelve a comprobar las reglas con los datos leídos en la propia
 *   transacción (para que un cambio concurrente no se cuele).
 *
 * No contienen acceso a la base de datos: reciben los datos ya cargados y
 * devuelven una respuesta. Así la lógica de disponibilidad NO se duplica: las
 * reglas y la revalidación comparten estos predicados.
 */

/** Intervalo `[inicio, fin)` en minutos desde medianoche. */
export interface IntervaloMinutos {
  inicio: number;
  fin: number;
}

/** Convierte `HH:mm` a minutos desde medianoche. */
export function aMinutos(hora: string): number {
  const [horas, minutos] = hora.split(':').map(Number);

  return (horas || 0) * 60 + (minutos || 0);
}

/**
 * `true` si dos intervalos `[inicio, fin)` se solapan.
 *
 * El solape es de intervalos, no de extremos: `[09:00, 10:00)` y
 * `[10:00, 11:00)` NO se solapan (una reserva que termina a las 10:00 no
 * impide empezar a las 10:00).
 */
export function seSolapan(a: IntervaloMinutos, b: IntervaloMinutos): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/** Intervalo de una franja horaria del catálogo. */
export function intervaloDeFranja(franja: {
  startTime: string;
  endTime: string;
}): IntervaloMinutos {
  return {
    inicio: aMinutos(franja.startTime),
    fin: aMinutos(franja.endTime),
  };
}

/**
 * `true` si la franja NO pertenece al horario semanal activo del barbero.
 *
 * El horario semanal se compara por hora de INICIO (la disponibilidad usa
 * bloques de 60 minutos) y, además, se exige que la franja del horario
 * CUBRA la solicitada: un horario de 09:00 a 13:00 no habilita una franja de
 * 13:00 a 14:00.
 */
export function estaFueraDelHorarioSemanal(
  franja: { startTime: string; endTime: string },
  franjasHorario: ReadonlyArray<{ startTime: string; endTime?: string | null }>,
): boolean {
  const solicitada = intervaloDeFranja(franja);

  return !franjasHorario.some((franjaHorario) => {
    if (franjaHorario.startTime !== franja.startTime) {
      return false;
    }

    if (!franjaHorario.endTime) {
      return true;
    }

    const horario = intervaloDeFranja({
      startTime: franjaHorario.startTime,
      endTime: franjaHorario.endTime,
    });

    return horario.inicio <= solicitada.inicio && horario.fin >= solicitada.fin;
  });
}

/**
 * `true` si un cierre general activo alcanza la franja.
 *
 * Un cierre `allDay` cubre todo el día; uno parcial se compara por
 * intervalos `[inicio, fin)`.
 */
export function estaCubiertaPorCierreGeneral(
  franja: { startTime: string; endTime: string },
  cierresActivos: ReadonlyArray<{
    allDay: boolean;
    startTime: string | null;
    endTime: string | null;
  }>,
): boolean {
  const solicitada = intervaloDeFranja(franja);

  return cierresActivos.some((cierre) => {
    if (cierre.allDay) {
      return true;
    }

    if (!cierre.startTime || !cierre.endTime) {
      return false;
    }

    return seSolapan(solicitada, {
      inicio: aMinutos(cierre.startTime),
      fin: aMinutos(cierre.endTime),
    });
  });
}

/**
 * `true` si un bloqueo activo del barbero solapa la franja.
 */
export function estaCubiertaPorBloqueo(
  franja: { startTime: string; endTime: string },
  bloqueosActivos: ReadonlyArray<{ startTime: string; endTime: string }>,
): boolean {
  const solicitada = intervaloDeFranja(franja);

  return bloqueosActivos.some((bloqueo) =>
    seSolapan(solicitada, intervaloDeFranja(bloqueo)),
  );
}

/**
 * `true` si alguna reserva que ocupa agenda solapa la franja.
 *
 * Las reservas se comparan por SOLAPE de intervalos: la restricción única de
 * la base solo cubre la hora de INICIO exacta, mientras que una reserva de
 * 09:00 a 10:00 choca con una de 09:30 a 10:30 aunque el índice no lo
 * detecte.
 */
export function solapaConReserva(
  franja: { startTime: string; endTime: string },
  reservas: ReadonlyArray<{ startTime: string; endTime: string }>,
): boolean {
  const solicitada = intervaloDeFranja(franja);

  return reservas.some((reserva) =>
    seSolapan(solicitada, intervaloDeFranja(reserva)),
  );
}

/** Franja del catálogo diario con sus horas de inicio y fin. */
export type FranjaEvaluable = Pick<FranjaHorario, 'startTime' | 'endTime'>;

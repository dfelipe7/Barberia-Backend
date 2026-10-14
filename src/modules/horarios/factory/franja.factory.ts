import { Injectable } from '@nestjs/common';

/** Apertura oficial de la jornada, hora de Bogotá. */
export const HORA_APERTURA_JORNADA = '09:00';

/** Cierre oficial de la jornada, hora de Bogotá. */
export const HORA_CIERRE_JORNADA = '20:00';

/** Granularidad fija de cada franja, en minutos. */
export const DURACION_FRANJA_MINUTOS = 60;

/**
 * Representación discreta de una franja horaria. Las horas son cadenas en
 * formato `HH:mm` (24 horas), ya resueltas en la zona horaria del negocio.
 */
export interface FranjaHorario {
  startTime: string;
  endTime: string;
}

const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTOS_POR_DIA = 24 * 60;

/**
 * Factory de franjas horarias de HE-08.
 *
 * Convierte rangos horarios válidos en el catálogo discreto de franjas de
 * 60 minutos de la jornada 09:00-20:00. No valida permisos, reservas ni
 * persistencia: solo aplica reglas deterministas de generación y validación.
 *
 * Un día sin horario se representa con una lista vacía administrada por la
 * capa de horario; esta factory nunca debe producir una franja de duración
 * cero (por eso `inicio === fin` es un error explícito).
 */
@Injectable()
export class FranjaFactory {
  private readonly minutosApertura: number;
  private readonly minutosCierre: number;

  constructor() {
    this.minutosApertura = this.aMinutos(HORA_APERTURA_JORNADA);
    this.minutosCierre = this.aMinutos(HORA_CIERRE_JORNADA);
  }

  /**
   * Genera el catálogo completo del día: 11 franjas consecutivas de 60 minutos,
   * desde `09:00-10:00` hasta `19:00-20:00`.
   */
  generarCatalogoDelDia(): FranjaHorario[] {
    return this.generarFranjas(HORA_APERTURA_JORNADA, HORA_CIERRE_JORNADA);
  }

  /**
   * Genera las franjas de 60 minutos que cubren un rango `[inicio, fin)`.
   *
   * Valida formato `HH:mm`, que el inicio sea anterior al fin, que el rango
   * esté dentro de la jornada, que el inicio esté alineado a `:00` y que la
   * duración sea divisible exactamente en bloques de 60 minutos.
   *
   * @throws RangeError cuando el rango no cumple las reglas de la jornada.
   */
  generarFranjas(inicio: string, fin: string): FranjaHorario[] {
    const inicioMinutos = this.aMinutos(inicio);
    const finMinutos = this.aMinutos(fin);
    this.validarRango(inicioMinutos, finMinutos);

    const franjas: FranjaHorario[] = [];
    for (
      let minuto = inicioMinutos;
      minuto < finMinutos;
      minuto += DURACION_FRANJA_MINUTOS
    ) {
      franjas.push({
        startTime: this.aHora(minuto),
        endTime: this.aHora(minuto + DURACION_FRANJA_MINUTOS),
      });
    }
    return franjas;
  }

  /**
   * Convierte una hora `HH:mm` a minutos desde la medianoche.
   * Punto único de conversión y validación de formato horario.
   *
   * @throws RangeError si la hora no cumple el formato estricto `HH:mm`.
   */
  aMinutos(hora: string): number {
    const valor: unknown = hora;
    if (typeof valor !== 'string' || !REGEX_HORA.test(valor)) {
      throw new RangeError(
        `Hora inválida: "${String(valor)}". Se esperaba el formato HH:mm`,
      );
    }

    const coincidencia = REGEX_HORA.exec(valor) as RegExpExecArray;
    return Number(coincidencia[1]) * 60 + Number(coincidencia[2]);
  }

  /**
   * Convierte minutos desde la medianoche a una hora `HH:mm`.
   *
   * @throws RangeError si los minutos no son un entero dentro de `[0, 1439]`.
   */
  aHora(minutos: number): string {
    if (
      !Number.isInteger(minutos) ||
      minutos < 0 ||
      minutos >= MINUTOS_POR_DIA
    ) {
      throw new RangeError(
        `Minutos inválidos: ${minutos}. Debe ser un entero entre 0 y ${MINUTOS_POR_DIA - 1}`,
      );
    }

    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    return `${this.aTexto(horas)}:${this.aTexto(resto)}`;
  }

  private validarRango(inicioMinutos: number, finMinutos: number): void {
    if (inicioMinutos === finMinutos) {
      throw new RangeError(
        'El rango de franjas no puede tener duración cero (inicio igual al fin). Un día sin horario se representa con una lista vacía, no con una franja vacía',
      );
    }

    if (inicioMinutos > finMinutos) {
      throw new RangeError(
        'La hora de inicio debe ser anterior a la hora de fin',
      );
    }

    if (
      inicioMinutos < this.minutosApertura ||
      finMinutos > this.minutosCierre
    ) {
      throw new RangeError(
        `El rango debe estar dentro de la jornada ${HORA_APERTURA_JORNADA}-${HORA_CIERRE_JORNADA}`,
      );
    }

    if (inicioMinutos % DURACION_FRANJA_MINUTOS !== 0) {
      throw new RangeError(
        `La hora de inicio debe estar alineada a bloques de ${DURACION_FRANJA_MINUTOS} minutos (:00)`,
      );
    }

    if ((finMinutos - inicioMinutos) % DURACION_FRANJA_MINUTOS !== 0) {
      throw new RangeError(
        `El rango debe ser divisible exactamente en bloques de ${DURACION_FRANJA_MINUTOS} minutos`,
      );
    }
  }

  private aTexto(valor: number): string {
    return valor.toString().padStart(2, '0');
  }
}

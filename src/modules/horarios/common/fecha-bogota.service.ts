import { Injectable } from '@nestjs/common';

/**
 * Zona horaria oficial del negocio. Se declara explícitamente para no depender
 * de la zona horaria del sistema operativo ni del contenedor.
 */
export const ZONA_HORARIA_BOGOTA = 'America/Bogota';

/**
 * Día de la semana en formato ISO en inglés. Es un tipo local para no depender
 * de enums de Prisma que todavía no existen en el esquema. Los valores coinciden
 * con los que usará el enum `WeekDay` de HE-08, por lo que son compatibles.
 */
export type DiaSemana =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

/**
 * Componentes de fecha y hora calculados en la zona horaria de Bogotá.
 * `fecha` es una fecha de calendario (`YYYY-MM-DD`) y `hora` una hora en
 * formato de 24 horas (`HH:mm`), ambas ya resueltas en Bogotá.
 */
export interface ComponentesFechaHoraBogota {
  fecha: string;
  hora: string;
  anio: number;
  mes: number;
  dia: number;
  hora24: number;
  minuto: number;
  diaSemana: DiaSemana;
}

const DIAS_SEMANA: readonly DiaSemana[] = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

const REGEX_FECHA_CALENDARIO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Utilidad compartida para trabajar con fechas y horas de Bogotá (UTC-5).
 *
 * Distingue de forma explícita dos conceptos:
 * - **Fecha de calendario** (`YYYY-MM-DD`): un día de agenda. No es un instante.
 *   Su día de la semana es independiente de la zona horaria y se calcula sin
 *   conversiones UTC que puedan desplazar el día.
 * - **Instante** (`Date`): un punto en el tiempo con hora y zona. Sus componentes
 *   se obtienen con `Intl.DateTimeFormat` fijando `America/Bogota`.
 */
@Injectable()
export class FechaBogotaService {
  private readonly formateadorBogota = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA_BOGOTA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  /**
   * Comprueba que un texto sea una fecha de calendario válida en formato
   * exacto `YYYY-MM-DD` y que represente un día real (mes, día y años bisiestos).
   */
  esFechaCalendarioValida(fecha: string): boolean {
    if (typeof fecha !== 'string') {
      return false;
    }

    const coincidencia = REGEX_FECHA_CALENDARIO.exec(fecha);
    if (!coincidencia) {
      return false;
    }

    const anio = Number(coincidencia[1]);
    const mes = Number(coincidencia[2]);
    const dia = Number(coincidencia[3]);

    const comprobacion = new Date(Date.UTC(anio, mes - 1, dia));
    return (
      comprobacion.getUTCFullYear() === anio &&
      comprobacion.getUTCMonth() === mes - 1 &&
      comprobacion.getUTCDate() === dia
    );
  }

  /**
   * Obtiene el día de la semana de una fecha de calendario (`YYYY-MM-DD`).
   * Al tratarse de un día de agenda, se calcula de forma neutra a la zona
   * horaria para no desplazar el día.
   *
   * @throws RangeError si la fecha no tiene el formato o no es un día válido.
   */
  obtenerDiaSemana(fecha: string): DiaSemana {
    const { anio, mes, dia } = this.parsearFechaCalendario(fecha);
    const indice = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
    return DIAS_SEMANA[indice];
  }

  /**
   * Calcula los componentes de fecha y hora de un instante en Bogotá.
   *
   * @throws RangeError si el argumento no es un `Date` válido.
   */
  obtenerComponentesBogota(instante: Date): ComponentesFechaHoraBogota {
    if (!(instante instanceof Date) || Number.isNaN(instante.getTime())) {
      throw new RangeError(
        'Se requiere un instante (Date) válido para obtener la fecha y hora de Bogotá',
      );
    }

    const partes = this.formateadorBogota.formatToParts(instante);
    const obtener = (tipo: Intl.DateTimeFormatPartTypes): number => {
      const parte = partes.find((p) => p.type === tipo);
      if (!parte) {
        throw new RangeError(
          `No se pudo obtener la parte "${tipo}" de la fecha de Bogotá`,
        );
      }
      return Number(parte.value);
    };

    const anio = obtener('year');
    const mes = obtener('month');
    const dia = obtener('day');
    const hora24 = obtener('hour');
    const minuto = obtener('minute');

    const fecha = `${this.aTexto(anio, 4)}-${this.aTexto(mes, 2)}-${this.aTexto(dia, 2)}`;
    const hora = `${this.aTexto(hora24, 2)}:${this.aTexto(minuto, 2)}`;

    return {
      fecha,
      hora,
      anio,
      mes,
      dia,
      hora24,
      minuto,
      diaSemana: this.obtenerDiaSemana(fecha),
    };
  }

  /**
   * Fecha de calendario (`YYYY-MM-DD`) de un instante en Bogotá.
   */
  obtenerFechaBogota(instante: Date): string {
    return this.obtenerComponentesBogota(instante).fecha;
  }

  /**
   * Hora (`HH:mm`) de un instante en Bogotá.
   */
  obtenerHoraBogota(instante: Date): string {
    return this.obtenerComponentesBogota(instante).hora;
  }

  private parsearFechaCalendario(fecha: string): {
    anio: number;
    mes: number;
    dia: number;
  } {
    if (!this.esFechaCalendarioValida(fecha)) {
      throw new RangeError(
        `Fecha de calendario inválida: "${fecha}". Se esperaba el formato YYYY-MM-DD`,
      );
    }

    const coincidencia = REGEX_FECHA_CALENDARIO.exec(fecha) as RegExpExecArray;
    return {
      anio: Number(coincidencia[1]),
      mes: Number(coincidencia[2]),
      dia: Number(coincidencia[3]),
    };
  }

  private aTexto(valor: number, longitud: number): string {
    return valor.toString().padStart(longitud, '0');
  }
}

import { Injectable } from '@nestjs/common';
import { WeekDay } from '../../../../generated/prisma/enums';
import { ReservasRepository } from '../repository/reservas.repository';
import type {
  ConsultaConflictoFranjaSemanal,
  ConsultaConflictoReserva,
  ProveedorReservasActivas,
} from '../../horarios/ports/proveedor-reservas-activas.port';

/**
 * Adaptador real del puerto `ProveedorReservasActivas` (HE-08) respaldado por la
 * persistencia de reservas de HE-04.
 *
 * Es la única pieza que traduce el contrato del puerto (fechas de calendario
 * `YYYY-MM-DD` y `dayOfWeek` como texto) a las primitivas tipadas del
 * repositorio (`Date` en UTC medianoche y enum `WeekDay`). No implementa reglas
 * de disponibilidad ni de negocio: esas viven en `DisponibilidadService` (HE-08)
 * y en la futura fachada de HE-04.
 *
 * Política de ocupación: la aplica el repositorio (ocupan todos los estados
 * menos `CANCELLED`). El adaptador no la reimplementa.
 *
 * Manejo de errores (`fail-closed`): si la consulta no puede resolverse (por
 * ejemplo, la base de datos no responde), el error de Prisma se propaga sin
 * capturarse. `DisponibilidadService` nunca degrada a "sin reservas" de forma
 * silenciosa; la consulta falla en lugar de anunciar una franja libre que podría
 * estar ocupada.
 */
@Injectable()
export class PrismaProveedorReservasActivas implements ProveedorReservasActivas {
  constructor(private readonly reservasRepository: ReservasRepository) {}

  /**
   * Traduce la consulta por fecha de calendario (`YYYY-MM-DD`) a la primitiva
   * del repositorio, que espera un `Date` en UTC medianoche para columnas
   * `@db.Date` (sin desplazamiento de zona horaria).
   */
  async existeReservaNoCanceladaEnFranja(
    consulta: ConsultaConflictoReserva,
  ): Promise<boolean> {
    return this.reservasRepository.existeReservaQueOcupaEnFranja({
      barberoId: consulta.barberoId,
      fecha: new Date(`${consulta.fecha}T00:00:00.000Z`),
      startTime: consulta.startTime,
      endTime: consulta.endTime,
    });
  }

  /**
   * Traduce el día de la semana de texto al enum `WeekDay`. Si el valor no es un
   * día válido se lanza un error en lugar de asumir una franja libre: un valor
   * corrupto no debe hacer que se anuncie disponibilidad falsa.
   */
  async existeReservaNoCanceladaEnFranjaSemanal(
    consulta: ConsultaConflictoFranjaSemanal,
  ): Promise<boolean> {
    return this.reservasRepository.existeReservaQueOcupaEnFranjaSemanal({
      barberoId: consulta.barberoId,
      dayOfWeek: this.aWeekDay(consulta.dayOfWeek),
      startTime: consulta.startTime,
      endTime: consulta.endTime,
    });
  }

  private aWeekDay(valor: string): WeekDay {
    if (!Object.values(WeekDay).includes(valor as WeekDay)) {
      throw new Error(`Día de la semana inválido: "${valor}"`);
    }
    return valor as WeekDay;
  }
}

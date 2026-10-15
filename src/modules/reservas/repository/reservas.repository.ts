import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReservationStatus, WeekDay } from '../../../../generated/prisma/enums';

/**
 * Persistencia de reservas (HE-04, subconjunto aprobado).
 *
 * Solo cubre lo que el puerto `ProveedorReservasActivas` de HE-08 necesita
 * (saber si una franja está ocupada) más las primitivas de escritura que
 * consumirá la capa de aplicación: crear (con bloqueo), leer y cancelar.
 *
 * No contiene lógica de disponibilidad ni de negocio de reservas: eso vive en
 * `DisponibilidadService` (HE-08) y en la futura fachada de HE-04.
 */

/**
 * Política de ocupación compartida con HE-08: ocupan la franja todos los
 * estados no cancelados. Se declara como lista explícita (en vez de
 * `!= CANCELLED`) para que un estado futuro no ocupe agenda por accidente.
 */
export const ESTADOS_QUE_OCUPAN_AGENDA: readonly ReservationStatus[] = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
  ReservationStatus.IN_PROGRESS,
  ReservationStatus.COMPLETED,
];

/**
 * Representación de una reserva desacoplada del modelo Prisma. `slotActivo` es
 * de solo lectura: lo calcula la base de datos (columna generada, ver
 * `prisma/migrations/*_agregar_reservations/migration.sql`).
 */
export interface ReservaRegistro {
  id: number;
  barberoId: number;
  date: Date;
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
  status: ReservationStatus;
  slotActivo: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConsultaOcupacionPorFecha {
  barberoId: number;
  fecha: Date;
  startTime: string;
  endTime: string;
}

export interface ConsultaOcupacionPorDiaSemana {
  barberoId: number;
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
}

export interface CrearReservaDatos {
  barberoId: number;
  date: Date;
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
  status?: ReservationStatus;
}

@Injectable()
export class ReservasRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Indica si la franja `[startTime, endTime)` de un barbero en una fecha
   * contiene una reserva que ocupa agenda. Usa solape de intervalos
   * (`startTime < endTime` y `endTime > startTime`); la comparación de `HH:mm`
   * como texto es cronológicamente correcta por el relleno con ceros.
   */
  async existeReservaQueOcupaEnFranja(
    consulta: ConsultaOcupacionPorFecha,
  ): Promise<boolean> {
    const reserva = await this.prisma.reservation.findFirst({
      where: {
        barberoId: consulta.barberoId,
        date: consulta.fecha,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
        startTime: { lt: consulta.endTime },
        endTime: { gt: consulta.startTime },
      },
      select: { id: true },
    });

    return reserva !== null;
  }

  /**
   * Indica si existe alguna reserva que ocupa agenda, en cualquier fecha, sobre
   * la franja semanal (`dayOfWeek` + rango). Se usa al reemplazar el horario
   * semanal para no invalidar reservas futuras sin enumerar fechas.
   */
  async existeReservaQueOcupaEnFranjaSemanal(
    consulta: ConsultaOcupacionPorDiaSemana,
  ): Promise<boolean> {
    const reserva = await this.prisma.reservation.findFirst({
      where: {
        barberoId: consulta.barberoId,
        dayOfWeek: consulta.dayOfWeek,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
        startTime: { lt: consulta.endTime },
        endTime: { gt: consulta.startTime },
      },
      select: { id: true },
    });

    return reserva !== null;
  }

  async obtenerPorId(id: number): Promise<ReservaRegistro | null> {
    return this.prisma.reservation.findUnique({ where: { id } });
  }

  /**
   * Crea una reserva serializando la escritura por barbero con un
   * `SELECT ... FOR UPDATE` sobre la fila de `Barbero`, dentro de una
   * transacción. La transacción por sí sola NO evita el doble booking: la
   * garantía real es el índice UNIQUE
   * `(barberoId, date, startTime, slotActivo)`, que permite varias reservas
   * `CANCELLED` (slotActivo NULL) y a lo sumo una activa por franja. La
   * violación del índice se propaga como error de Prisma (`P2002`) para que la
   * capa de aplicación lo traduzca a 409.
   */
  async crearConBloqueo(datos: CrearReservaDatos): Promise<ReservaRegistro> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Barbero WHERE id = ${datos.barberoId} FOR UPDATE`;

      return tx.reservation.create({
        data: {
          barberoId: datos.barberoId,
          date: datos.date,
          dayOfWeek: datos.dayOfWeek,
          startTime: datos.startTime,
          endTime: datos.endTime,
          status: datos.status ?? ReservationStatus.PENDING,
        },
      });
    });
  }

  /**
   * Cancela una reserva sin borrarla. Al pasar a `CANCELLED`, la columna
   * generada `slotActivo` queda en NULL y libera la franja para una nueva
   * reserva (re-reserva), conservando el historial.
   */
  async cancelar(id: number): Promise<ReservaRegistro> {
    return this.prisma.reservation.update({
      where: { id },
      data: { status: ReservationStatus.CANCELLED },
    });
  }
}

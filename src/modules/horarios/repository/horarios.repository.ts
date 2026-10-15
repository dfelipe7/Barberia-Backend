import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WeekDay } from '../../../../generated/prisma/enums';

/**
 * Datos mínimos que el repositorio de horarios necesita para persistir una
 * franja semanal. Se mantiene desacoplado del DTO HTTP para que la capa de
 * servicio sea la única que conozca el contrato de entrada.
 */
export interface FranjaHorarioPersistencia {
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
}

@Injectable()
export class HorariosRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene las franjas activas del horario semanal de un barbero,
   * ordenadas por día (MONDAY..SUNDAY) y hora de inicio.
   */
  async obtenerFranjasActivasPorBarbero(barberoId: number) {
    return this.prisma.barberWeeklySlot.findMany({
      where: {
        barberoId,
        active: true,
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  /**
   * Obtiene las franjas activas del barbero para un día de la semana concreto,
   * ordenadas por hora de inicio. Se usa al validar que un bloqueo caiga dentro
   * del horario semanal de ese día.
   */
  async obtenerFranjasActivasPorBarberoYDia(
    barberoId: number,
    dayOfWeek: WeekDay,
  ) {
    return this.prisma.barberWeeklySlot.findMany({
      where: {
        barberoId,
        dayOfWeek,
        active: true,
      },
      orderBy: { startTime: 'asc' },
    });
  }

  /**
   * Persiste el conjunto de franjas vigentes del barbero.
   *
   * Realiza un `upsert` por cada franja (clave compuesta barbero/día/hora) en
   * una sola transacción, reactivando cualquier franja que hubiese quedado
   * inactiva. No elimina filas: la verificación de reservas activas que
   * autorizaría la eliminación pertenece a HE-04 y aún no está integrada.
   */
  async reemplazarFranjas(
    barberoId: number,
    franjas: FranjaHorarioPersistencia[],
  ) {
    if (franjas.length > 0) {
      await this.prisma.$transaction(
        franjas.map((franja) =>
          this.prisma.barberWeeklySlot.upsert({
            where: {
              barberoId_dayOfWeek_startTime: {
                barberoId,
                dayOfWeek: franja.dayOfWeek,
                startTime: franja.startTime,
              },
            },
            update: {
              endTime: franja.endTime,
              active: true,
            },
            create: {
              barberoId,
              dayOfWeek: franja.dayOfWeek,
              startTime: franja.startTime,
              endTime: franja.endTime,
              active: true,
            },
          }),
        ),
      );
    }

    return this.obtenerFranjasActivasPorBarbero(barberoId);
  }
}

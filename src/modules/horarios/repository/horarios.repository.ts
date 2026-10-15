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
   * Persiste el conjunto de franjas vigentes del barbero (reemplazo completo).
   *
   * En una sola transacción desactiva lógicamente todas las franjas activas del
   * barbero y luego hace `upsert` de las franjas recibidas (clave compuesta
   * barbero/día/hora), reactivando las que se conservan. No borra filas: el
   * historial se mantiene vía la bandera `active`.
   *
   * La política de reservas (HE-04) que autoriza eliminar franjas se verifica
   * en la capa de servicio antes de invocar este método; aquí solo se persiste
   * el conjunto final.
   */
  async reemplazarFranjas(
    barberoId: number,
    franjas: FranjaHorarioPersistencia[],
  ) {
    const operaciones = [
      this.prisma.barberWeeklySlot.updateMany({
        where: { barberoId, active: true },
        data: { active: false },
      }),
      ...franjas.map((franja) =>
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
    ];

    await this.prisma.$transaction(operaciones);

    return this.obtenerFranjasActivasPorBarbero(barberoId);
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import {
  ScheduleBlockReason,
  ScheduleBlockStatus,
} from '../../../../generated/prisma/enums';

/**
 * Datos de salida desacoplados del modelo Prisma que consume la capa de
 * servicio. Un bloqueo nunca se borra físicamente: los cambios de estado
 * (`CANCELLED`, `REACTIVATED`) conservan el registro y el historial.
 */
export interface BloqueoHorarioRegistro {
  id: number;
  barberoId: number;
  date: Date;
  startTime: string;
  endTime: string;
  reason: ScheduleBlockReason | null;
  notes: string | null;
  status: ScheduleBlockStatus;
  reactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CrearBloqueoDatos {
  barberoId: number;
  date: Date;
  startTime: string;
  endTime: string;
  reason: ScheduleBlockReason | null;
  notes: string | null;
}

export interface ActualizarBloqueoDatos {
  date?: Date;
  startTime?: string;
  endTime?: string;
  reason?: ScheduleBlockReason | null;
  notes?: string | null;
  status?: ScheduleBlockStatus;
  reactivatedAt?: Date | null;
  reactivatedBy?: number | null;
}

export interface FiltroBloqueosPersistencia {
  date?: Date;
  status?: ScheduleBlockStatus;
}

@Injectable()
export class BloqueosHorarioRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  async crear(datos: CrearBloqueoDatos): Promise<BloqueoHorarioRegistro> {
    return this.prisma.barberScheduleBlock.create({
      data: {
        barberoId: datos.barberoId,
        date: datos.date,
        startTime: datos.startTime,
        endTime: datos.endTime,
        reason: datos.reason,
        notes: datos.notes,
        status: ScheduleBlockStatus.ACTIVE,
        negocioId: this.aislamiento.negocioIdRequerido(),
      },
    });
  }

  async obtenerPorId(id: number): Promise<BloqueoHorarioRegistro | null> {
    return this.prisma.barberScheduleBlock.findFirst({
      where: this.aislamiento.filtroLectura({ id }),
    });
  }

  async listarPorBarbero(
    barberoId: number,
    filtro?: FiltroBloqueosPersistencia,
  ): Promise<BloqueoHorarioRegistro[]> {
    return this.prisma.barberScheduleBlock.findMany({
      where: this.aislamiento.filtroLectura({
        barberoId,
        ...(filtro?.date ? { date: filtro.date } : {}),
        ...(filtro?.status ? { status: filtro.status } : {}),
      }),
      orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
    });
  }

  async listarActivosPorBarberoYFecha(
    barberoId: number,
    date: Date,
  ): Promise<BloqueoHorarioRegistro[]> {
    return this.prisma.barberScheduleBlock.findMany({
      where: this.aislamiento.filtroLectura({
        barberoId,
        date,
        status: ScheduleBlockStatus.ACTIVE,
      }),
    });
  }

  async actualizar(
    id: number,
    datos: ActualizarBloqueoDatos,
  ): Promise<BloqueoHorarioRegistro> {
    return this.prisma.barberScheduleBlock.update({
      where: this.aislamiento.filtroEscritura({ id }),
      data: datos,
    });
  }
}

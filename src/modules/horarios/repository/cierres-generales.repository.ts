import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Registro de un cierre general activo, desacoplado del modelo Prisma.
 */
export interface CierreGeneralActivo {
  id: number;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  reason: string;
}

/**
 * Consulta de cierres generales (`GeneralClosure`).
 *
 * HE-08 solo consume cierres existentes: la administración completa de cierres
 * generales no tiene alcance aprobado, por lo que este repositorio únicamente
 * expone la lectura necesaria para validar bloqueos.
 */
@Injectable()
export class CierresGeneralesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerActivosEnFecha(date: Date): Promise<CierreGeneralActivo[]> {
    return this.prisma.generalClosure.findMany({
      where: { date, active: true },
    });
  }
}

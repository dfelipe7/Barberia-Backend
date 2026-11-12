import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Descuento } from '../../../../generated/prisma/client';
import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import {
  MENSAJE_DESCUENTO_DUPLICADO,
  MENSAJE_DESCUENTO_NO_ENCONTRADO,
} from '../descuentos.constants';
import type { DatosDescuento } from '../service/descuento.service';

/** Cambios permitidos al modificar un descuento (HE-10-HU-03). */
export interface CambiosDescuento {
  porcentaje?: number;
  diasSemana?: WeekDay[];
}

/** Descuento con el elemento (producto o servicio) incluido. */
export type DescuentoConElemento = Descuento & {
  producto: { id: number; nombre: string } | null;
  servicio: { id: number; nombre: string } | null;
};

/** Acceso a datos de descuentos, siempre acotado al negocio del contexto. */
@Injectable()
export class DescuentoRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  obtenerPorId(id: number): Promise<DescuentoConElemento | null> {
    return this.prisma.descuento.findFirst({
      where: this.aislamiento.filtroLectura({ id }),
      include: {
        producto: { select: { id: true, nombre: true } },
        servicio: { select: { id: true, nombre: true } },
      },
    });
  }

  buscarPorElemento(tipo: TipoDescuento, elementoId: number) {
    const where =
      tipo === TipoDescuento.PRODUCTO
        ? { productoId: elementoId }
        : { servicioId: elementoId };

    return this.prisma.descuento.findFirst({
      where: this.aislamiento.filtroLectura(where),
    });
  }

  async crear(data: DatosDescuento): Promise<Descuento> {
    try {
      return await this.prisma.descuento.create({
        data: {
          negocioId: this.aislamiento.negocioIdRequerido(),
          tipo: data.tipo,
          productoId: data.productoId,
          servicioId: data.servicioId,
          porcentaje: data.porcentaje,
          diasSemana: data.diasSemana,
          activo: false,
        },
      });
    } catch (error) {
      // La base de datos es la última barrera ante dos altas simultáneas.
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException(MENSAJE_DESCUENTO_DUPLICADO);
      }

      throw error;
    }
  }

  async actualizar(
    id: number,
    data: CambiosDescuento,
  ): Promise<DescuentoConElemento> {
    try {
      return await this.prisma.descuento.update({
        where: this.aislamiento.filtroEscritura({ id }),
        data: {
          ...(data.porcentaje !== undefined
            ? { porcentaje: data.porcentaje }
            : {}),
          ...(data.diasSemana !== undefined
            ? { diasSemana: data.diasSemana }
            : {}),
        },
        include: {
          producto: { select: { id: true, nombre: true } },
          servicio: { select: { id: true, nombre: true } },
        },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2025') {
        throw new NotFoundException(MENSAJE_DESCUENTO_NO_ENCONTRADO);
      }

      throw error;
    }
  }
}

import { ConflictException, Injectable } from '@nestjs/common';
import { Descuento } from '../../../../generated/prisma/client';
import { TipoDescuento } from '../../../../generated/prisma/enums';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { MENSAJE_DESCUENTO_DUPLICADO } from '../descuentos.constants';
import type { DatosDescuento } from '../service/descuento.service';

/** Acceso a datos de descuentos, siempre acotado al negocio del contexto. */
@Injectable()
export class DescuentoRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

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
}

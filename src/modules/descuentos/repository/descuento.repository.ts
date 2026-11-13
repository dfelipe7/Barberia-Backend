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

  /** Devuelve todos los descuentos del negocio activo ordenados por estado y fecha (HE-10-HU-01). */
  listar(): Promise<DescuentoConElemento[]> {
    return this.prisma.descuento.findMany({
      where: this.aislamiento.filtroLectura({}),
      orderBy: [{ activo: 'desc' }, { creadoEn: 'asc' }],
      include: {
        producto: { select: { id: true, nombre: true } },
        servicio: { select: { id: true, nombre: true } },
      },
    });
  }

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
    // TODO(H7): fail-fast si TipoDescuento crece (COMBO, PACK)
    const where =
      tipo === TipoDescuento.PRODUCTO
        ? { productoId: elementoId }
        : { servicioId: elementoId };

    return this.prisma.descuento.findFirst({
      where: this.aislamiento.filtroLectura(where),
    });
  }

  private readonly cacheZonaHoraria = new Map<
    number,
    { valor: string; expiraEn: number }
  >();
  private readonly TTL_ZONA_HORARIA_MS = 5 * 60 * 1000; // 5 minutos

  /**
   * Obtiene la zona horaria oficial configurada para el negocio con caché en memoria (H3).
   * @param negocioId - Identificador del negocio
   * @returns Nombre IANA de la zona horaria (ej. 'America/Bogota')
   */
  async obtenerZonaHorariaNegocio(negocioId: number): Promise<string> {
    const ahora = Date.now();
    const cacheado = this.cacheZonaHoraria.get(negocioId);
    if (cacheado && cacheado.expiraEn > ahora) {
      return cacheado.valor;
    }

    const negocio = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { zonaHoraria: true },
    });

    const valor = negocio?.zonaHoraria ?? 'America/Bogota';
    this.cacheZonaHoraria.set(negocioId, {
      valor,
      expiraEn: ahora + this.TTL_ZONA_HORARIA_MS,
    });
    return valor;
  }

  /** Invalida la entrada en caché de zona horaria para un negocio. */
  invalidarZonaHoraria(negocioId: number): void {
    this.cacheZonaHoraria.delete(negocioId);
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

  /**
   * Desactiva (soft) todos los descuentos de PRODUCTO activos asociados al
   * productoId indicado en el negocio del contexto. Se invoca en cascada
   * cuando el producto es desactivado (P2).
   */
  desactivarPorProducto(productoId: number): Promise<{ count: number }> {
    return this.prisma.descuento.updateMany({
      where: this.aislamiento.filtroLectura({
        tipo: TipoDescuento.PRODUCTO,
        productoId,
        activo: true,
      }),
      data: { activo: false },
    });
  }

  async cambiarEstado(
    id: number,
    activo: boolean,
  ): Promise<DescuentoConElemento> {
    try {
      return await this.prisma.descuento.update({
        where: this.aislamiento.filtroEscritura({ id }),
        data: { activo },
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

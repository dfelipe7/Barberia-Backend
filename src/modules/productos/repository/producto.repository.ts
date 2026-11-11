import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoProducto } from '../../../../generated/prisma/enums';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { CambiosProducto, DatosProducto } from '../service/producto.service';
import {
  MENSAJE_NOMBRE_DUPLICADO,
  MENSAJE_PRODUCTO_NO_DISPONIBLE,
} from '../productos.constants';

/** Acceso a datos de productos, siempre acotado al negocio del contexto. */
@Injectable()
export class ProductoRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  buscarPorNombre(nombre: string) {
    return this.prisma.producto.findFirst({
      where: this.aislamiento.filtroLectura({ nombre }),
    });
  }

  listar() {
    return this.prisma.producto.findMany({
      where: this.aislamiento.filtroLectura(),
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
    });
  }

  /** Catálogo público: solo productos ACTIVO del negocio del contexto. */
  listarCatalogo() {
    return this.prisma.producto.findMany({
      where: this.aislamiento.filtroLectura({
        estado: EstadoProducto.ACTIVO,
      }),
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
  }

  /** Detalle público: solo si el producto es ACTIVO y del negocio actual. */
  obtenerDisponiblePorId(id: number) {
    return this.prisma.producto.findFirst({
      where: this.aislamiento.filtroLectura({
        id,
        estado: EstadoProducto.ACTIVO,
      }),
    });
  }

  obtenerPorId(id: number) {
    return this.prisma.producto.findFirst({
      where: this.aislamiento.filtroLectura({ id }),
    });
  }

  async crear(data: DatosProducto & { imagenUrl: string | null }) {
    try {
      return await this.prisma.producto.create({
        data: {
          nombre: data.nombre,
          descripcion: data.descripcion,
          precio: data.precio,
          imagenUrl: data.imagenUrl,
          estado: EstadoProducto.ACTIVO,
          negocioId: this.aislamiento.negocioIdRequerido(),
        },
      });
    } catch (error) {
      // La base de datos es la última barrera ante dos altas simultáneas.
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException(MENSAJE_NOMBRE_DUPLICADO);
      }

      throw error;
    }
  }

  async actualizar(id: number, data: CambiosProducto) {
    try {
      return await this.prisma.producto.update({
        where: this.aislamiento.filtroEscritura({ id }),
        data,
      });
    } catch (error) {
      const codigo = (error as { code?: string })?.code;

      if (codigo === 'P2002') {
        throw new ConflictException(MENSAJE_NOMBRE_DUPLICADO);
      }

      if (codigo === 'P2025') {
        throw new NotFoundException(MENSAJE_PRODUCTO_NO_DISPONIBLE);
      }

      throw error;
    }
  }

  /**
   * Actualiza el estado solo si difiere del actual. Devuelve el conteo de
   * filas afectadas: 0 cuando ya estaba en el estado objetivo o no existe.
   */
  actualizarEstadoSiDifiere(id: number, estado: EstadoProducto) {
    return this.prisma.producto.updateMany({
      where: this.aislamiento.filtroEscritura({
        id,
        estado: { not: estado },
      }),
      data: { estado },
    });
  }

  /** Evita borrar una imagen que otro producto del mismo negocio comparte. */
  async tieneOtraReferenciaAImagen(
    imagenUrl: string,
    exceptoId: number,
  ): Promise<boolean> {
    const total = await this.prisma.producto.count({
      where: this.aislamiento.filtroLectura({
        imagenUrl,
        id: { not: exceptoId },
      }),
    });

    return total > 0;
  }
}

import { ConflictException, Injectable } from '@nestjs/common';
import { EstadoProducto } from '../../../../generated/prisma/enums';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { DatosProducto } from '../service/producto.service';
import { MENSAJE_NOMBRE_DUPLICADO } from '../productos.constants';

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
}

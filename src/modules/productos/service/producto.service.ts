import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Producto } from '../../../../generated/prisma/client';
import {
  detectarTipoArchivo,
  TipoArchivo,
} from '../../../common/security/detectar-tipo-archivo';
import { CrearProductoDto } from '../dto/dto-peticion/crear-producto.dto';
import {
  ProductoResponseDto,
  ProductosListadoResponseDto,
} from '../dto/dto-respuesta/producto-response.dto';
import {
  FORMATOS_IMAGEN_PRODUCTO,
  LIMITE_BYTES_IMAGEN_PRODUCTO,
  MENSAJE_IMAGEN_INVALIDA,
  MENSAJE_NOMBRE_DUPLICADO,
  MENSAJE_PRODUCTO_NO_DISPONIBLE,
  MENSAJE_SIN_PRODUCTOS,
  PRECIO_MAXIMO_PRODUCTO,
  PRECIO_MINIMO_PRODUCTO,
} from '../productos.constants';
import { ProductoRepository } from '../repository/producto.repository';

export interface DatosProducto {
  nombre: string;
  descripcion?: string;
  precio: number;
}

export interface ImagenProducto {
  contenido: Buffer;
  extension: string;
}

/** Reglas de negocio del producto, sin HTTP ni Prisma. */
@Injectable()
export class ProductoService {
  constructor(private readonly repository: ProductoRepository) {}

  /**
   * Normaliza y valida los datos de texto, y comprueba la unicidad por
   * negocio antes de tocar el disco o la base de datos.
   */
  async validarRegistro(dto: CrearProductoDto): Promise<DatosProducto> {
    const nombre = dto.nombre.trim();

    if (!nombre) {
      throw new BadRequestException('El nombre del producto es obligatorio');
    }

    const descripcion = dto.descripcion?.trim() || undefined;
    const precio = Number(dto.precio);

    if (
      !Number.isFinite(precio) ||
      precio < PRECIO_MINIMO_PRODUCTO ||
      precio > PRECIO_MAXIMO_PRODUCTO
    ) {
      throw new BadRequestException(
        `El precio debe estar entre ${PRECIO_MINIMO_PRODUCTO} y ${PRECIO_MAXIMO_PRODUCTO}`,
      );
    }

    if (Math.abs(precio * 100 - Math.round(precio * 100)) > 1e-9) {
      throw new BadRequestException('El precio admite máximo dos decimales');
    }

    const existente = await this.repository.buscarPorNombre(nombre);
    if (existente) {
      throw new ConflictException(MENSAJE_NOMBRE_DUPLICADO);
    }

    return { nombre, descripcion, precio };
  }

  /**
   * Valida la firma real de la imagen y devuelve el contenido y la extensión
   * que el servidor usará. La imagen es OPCIONAL.
   * Si no se envía archivo, devuelve null.
   * Si se envía pero está vacío, excede el límite o no es JPG/PNG/WEBP, lanza 400.
   */
  validarImagen(archivo?: Express.Multer.File): ImagenProducto | null {
    if (!archivo) {
      return null;
    }

    if (!archivo.buffer?.length) {
      throw new BadRequestException(MENSAJE_IMAGEN_INVALIDA);
    }

    if (
      archivo.size > LIMITE_BYTES_IMAGEN_PRODUCTO ||
      archivo.buffer.length > LIMITE_BYTES_IMAGEN_PRODUCTO
    ) {
      throw new BadRequestException(MENSAJE_IMAGEN_INVALIDA);
    }

    const tipo = detectarTipoArchivo(archivo.buffer);
    const formatos: readonly TipoArchivo[] = FORMATOS_IMAGEN_PRODUCTO;

    if (!formatos.includes(tipo)) {
      throw new BadRequestException(MENSAJE_IMAGEN_INVALIDA);
    }

    return {
      contenido: archivo.buffer,
      extension: tipo === 'jpeg' ? 'jpg' : tipo,
    };
  }

  /** Listado administrativo: activos e inactivos del negocio activo. */
  async listar(): Promise<ProductosListadoResponseDto> {
    const productos = await this.repository.listar();

    if (productos.length === 0) {
      return { mensaje: MENSAJE_SIN_PRODUCTOS, productos: [] };
    }

    return { productos: productos.map((producto) => this.mapear(producto)) };
  }

  /** Detalle administrativo; un producto ajeno se comporta como inexistente. */
  async obtenerPorId(id: number): Promise<ProductoResponseDto> {
    const producto = await this.repository.obtenerPorId(id);

    if (!producto) {
      throw new NotFoundException(MENSAJE_PRODUCTO_NO_DISPONIBLE);
    }

    return this.mapear(producto);
  }

  mapear(producto: Producto): ProductoResponseDto {
    return {
      id: producto.id,
      nombre: producto.nombre,
      descripcion: producto.descripcion,
      precio: Number(producto.precio),
      imagenUrl: producto.imagenUrl,
      estado: producto.estado,
      creadoEn: producto.creadoEn,
      actualizadoEn: producto.actualizadoEn,
    };
  }
}

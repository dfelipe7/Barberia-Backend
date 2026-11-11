import { Injectable, Logger } from '@nestjs/common';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { ActualizarProductoDto } from '../dto/dto-peticion/actualizar-producto.dto';
import { CambiarEstadoProductoDto } from '../dto/dto-peticion/cambiar-estado-producto.dto';
import { CrearProductoDto } from '../dto/dto-peticion/crear-producto.dto';
import {
  ProductoActualizadoResponseDto,
  ProductoCatalogoResponseDto,
  ProductoEstadoResponseDto,
  ProductoRegistradoResponseDto,
  ProductoResponseDto,
  ProductosCatalogoResponseDto,
  ProductosListadoResponseDto,
} from '../dto/dto-respuesta/producto-response.dto';
import { MENSAJE_PRODUCTO_ACTUALIZADO } from '../productos.constants';
import { AlmacenamientoProductosService } from '../service/almacenamiento-productos.service';
import { ProductoService } from '../service/producto.service';

/**
 * Punto único de entrada del catálogo. Orquesta validación, almacenamiento y
 * persistencia; el controlador no conoce ninguna de esas piezas.
 */
@Injectable()
export class ProductosFacade {
  private readonly logger = new Logger(ProductosFacade.name);

  constructor(
    private readonly productoService: ProductoService,
    private readonly almacenamiento: AlmacenamientoProductosService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  async listar(): Promise<ProductosListadoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return this.productoService.listar();
  }

  async listarCatalogo(): Promise<ProductosCatalogoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return this.productoService.listarCatalogo();
  }

  async obtenerCatalogoPorId(id: number): Promise<ProductoCatalogoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return this.productoService.obtenerCatalogoPorId(id);
  }

  async obtenerPorId(id: number): Promise<ProductoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return this.productoService.obtenerPorId(id);
  }

  async cambiarEstado(
    id: number,
    dto: CambiarEstadoProductoDto,
  ): Promise<ProductoEstadoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return this.productoService.cambiarEstadoProducto(id, dto);
  }

  async registrar(
    dto: CrearProductoDto,
    archivo?: Express.Multer.File,
  ): Promise<ProductoRegistradoResponseDto> {
    const negocioId = this.aislamiento.negocioIdRequerido();
    const datos = await this.productoService.validarRegistro(dto);
    const imagen = this.productoService.validarImagen(archivo);

    let imagenUrl: string | null = null;
    if (imagen) {
      imagenUrl = await this.almacenamiento.guardar(
        negocioId,
        imagen.contenido,
        imagen.extension,
      );
    }

    try {
      const producto = await this.productoService.crearProducto({
        ...datos,
        imagenUrl,
      });

      return {
        mensaje: 'Producto registrado correctamente',
        producto: this.productoService.mapear(producto),
      };
    } catch (error) {
      // Si la persistencia falla, el archivo recién escrito no debe quedar
      // huérfano. Multer trabaja en memoria: nunca hubo un temporal en disco.
      if (imagenUrl) {
        await this.almacenamiento.eliminar(negocioId, imagenUrl);
      }
      throw error;
    }
  }

  async actualizar(
    id: number,
    dto: ActualizarProductoDto,
    archivo?: Express.Multer.File,
  ): Promise<ProductoActualizadoResponseDto> {
    const negocioId = this.aislamiento.negocioIdRequerido();
    const imagen = this.productoService.validarImagen(archivo);
    const { actual, cambios } = await this.productoService.validarActualizacion(
      id,
      dto,
      Boolean(imagen),
    );

    let nuevaImagenUrl: string | undefined;
    if (imagen) {
      nuevaImagenUrl = await this.almacenamiento.guardar(
        negocioId,
        imagen.contenido,
        imagen.extension,
      );
    }

    try {
      const datos = nuevaImagenUrl
        ? { ...cambios, imagenUrl: nuevaImagenUrl }
        : cambios;
      const producto =
        Object.keys(datos).length === 0
          ? actual
          : await this.productoService.actualizarProducto(id, datos);

      if (
        nuevaImagenUrl &&
        actual.imagenUrl &&
        actual.imagenUrl !== nuevaImagenUrl
      ) {
        await this.eliminarImagenAnterior(negocioId, id, actual.imagenUrl);
      }

      return {
        mensaje: MENSAJE_PRODUCTO_ACTUALIZADO,
        producto: this.productoService.mapear(producto),
      };
    } catch (error) {
      if (nuevaImagenUrl) {
        await this.almacenamiento.eliminar(negocioId, nuevaImagenUrl);
      }
      throw error;
    }
  }

  private async eliminarImagenAnterior(
    negocioId: number,
    productoId: number,
    imagenAnterior: string,
  ): Promise<void> {
    try {
      const compartida = await this.productoService.tieneOtraReferenciaAImagen(
        imagenAnterior,
        productoId,
      );

      if (!compartida) {
        await this.almacenamiento.eliminar(negocioId, imagenAnterior);
      }
    } catch (error) {
      // La actualización ya está confirmada: no se convierte en un 500 por no
      // poder limpiar un archivo antiguo. El almacenamiento registra el fallo.
      this.logger.warn(
        `No se pudo limpiar la imagen anterior del producto ${productoId}: ` +
          `${(error as Error)?.message ?? 'error desconocido'}`,
      );
    }
  }
}

import { Injectable } from '@nestjs/common';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { CrearProductoDto } from '../dto/dto-peticion/crear-producto.dto';
import {
  ProductoRegistradoResponseDto,
  ProductoResponseDto,
  ProductosListadoResponseDto,
} from '../dto/dto-respuesta/producto-response.dto';
import { ProductoRepository } from '../repository/producto.repository';
import { AlmacenamientoProductosService } from '../service/almacenamiento-productos.service';
import { ProductoService } from '../service/producto.service';

/**
 * Punto único de entrada de la HU-01. Orquesta validación, almacenamiento y
 * persistencia; el controlador no conoce ninguna de esas piezas.
 */
@Injectable()
export class ProductosFacade {
  constructor(
    private readonly productoService: ProductoService,
    private readonly almacenamiento: AlmacenamientoProductosService,
    private readonly repository: ProductoRepository,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  async listar(): Promise<ProductosListadoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return this.productoService.listar();
  }

  async obtenerPorId(id: number): Promise<ProductoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return this.productoService.obtenerPorId(id);
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
      const producto = await this.repository.crear({
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
}

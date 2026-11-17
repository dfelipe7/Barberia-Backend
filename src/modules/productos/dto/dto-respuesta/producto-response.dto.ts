import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DescuentoAplicableResponseDto } from '../../../descuentos/dto/dto-respuesta/descuento-aplicable-response.dto';

/** Producto tal como lo consume el panel administrativo. */
export class ProductoResponseDto {
  @ApiProperty({ example: 1, description: 'ID único del producto' })
  id: number;

  @ApiProperty({ example: 'Cera para cabello' })
  nombre: string;

  @ApiProperty({
    example: 'Cera de fijación fuerte con acabado mate',
    required: false,
  })
  descripcion?: string | null;

  @ApiProperty({ example: 35000, description: 'Precio del producto' })
  precio: number;

  @ApiProperty({ example: 35000, description: 'Precio original del producto' })
  precioOriginal: number;

  @ApiProperty({
    example: 35000,
    description: 'Precio final del producto tras aplicar descuento vigente',
  })
  precioFinal: number;

  @ApiPropertyOptional({
    type: DescuentoAplicableResponseDto,
    nullable: true,
    description: 'Información del descuento aplicable al producto si existe',
  })
  descuentoAplicable?: DescuentoAplicableResponseDto | null;

  @ApiProperty({
    example: '/uploads/negocios/1/productos/producto-1234-abcd.jpg',
    description: 'Ruta pública de la imagen del producto',
    nullable: true,
    required: false,
  })
  imagenUrl: string | null;

  @ApiProperty({ example: 'ACTIVO', description: 'Estado del producto' })
  estado: string;

  @ApiProperty({ type: String, format: 'date-time' })
  creadoEn: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  actualizadoEn: Date;
}

/** Respuesta del registro de un producto. */
export class ProductoRegistradoResponseDto {
  @ApiProperty({ example: 'Producto registrado correctamente' })
  mensaje: string;

  @ApiProperty({ type: ProductoResponseDto })
  producto: ProductoResponseDto;
}

/** Respuesta de la edición de un producto. */
export class ProductoActualizadoResponseDto {
  @ApiProperty({ example: 'Producto actualizado correctamente' })
  mensaje: string;

  @ApiProperty({ type: ProductoResponseDto })
  producto: ProductoResponseDto;
}

/** Respuesta del cambio de estado de un producto. */
export class ProductoEstadoResponseDto {
  @ApiProperty({ example: 'Estado del producto actualizado correctamente' })
  mensaje: string;

  @ApiProperty({ type: ProductoResponseDto })
  producto: ProductoResponseDto;
}

/** Listado administrativo: incluye productos activos e inactivos. */
export class ProductosListadoResponseDto {
  @ApiPropertyOptional({
    example: 'No existen productos registrados',
    description:
      'Presente únicamente cuando el negocio no tiene productos registrados.',
  })
  mensaje?: string;

  @ApiProperty({ type: [ProductoResponseDto] })
  productos: ProductoResponseDto[];
}

/** Producto visible en el catálogo público: solo datos comerciales. */
export class ProductoCatalogoResponseDto {
  @ApiProperty({ example: 1, description: 'ID único del producto' })
  id: number;

  @ApiProperty({ example: 'Cera para cabello' })
  nombre: string;

  @ApiProperty({
    example: 'Cera de fijación fuerte con acabado mate',
    required: false,
    nullable: true,
  })
  descripcion?: string | null;

  @ApiProperty({ example: 35000, description: 'Precio del producto' })
  precio: number;

  @ApiProperty({ example: 35000, description: 'Precio original del producto' })
  precioOriginal: number;

  @ApiProperty({
    example: 35000,
    description: 'Precio final del producto tras aplicar descuento vigente',
  })
  precioFinal: number;

  @ApiPropertyOptional({
    type: DescuentoAplicableResponseDto,
    nullable: true,
    description: 'Información del descuento aplicable al producto si existe',
  })
  descuentoAplicable?: DescuentoAplicableResponseDto | null;

  @ApiProperty({
    example: '/uploads/negocios/1/productos/producto-1234-abcd.jpg',
    description: 'Ruta pública de la imagen del producto',
    nullable: true,
    required: false,
  })
  imagenUrl: string | null;
}

/** Catálogo público: únicamente productos ACTIVO del negocio del contexto. */
export class ProductosCatalogoResponseDto {
  @ApiPropertyOptional({
    example: 'No hay productos disponibles en este momento',
    description:
      'Presente únicamente cuando el negocio no tiene productos activos.',
  })
  mensaje?: string;

  @ApiProperty({ type: [ProductoCatalogoResponseDto] })
  productos: ProductoCatalogoResponseDto[];
}

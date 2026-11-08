import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

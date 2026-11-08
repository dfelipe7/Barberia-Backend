import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EstadoProducto } from '../../../../../generated/prisma/enums';

/** Nuevo estado explícito de un producto; no es un toggle ciego. */
export class CambiarEstadoProductoDto {
  @ApiProperty({
    description: 'Nuevo estado para el producto',
    enum: EstadoProducto,
    example: 'INACTIVO',
  })
  @IsEnum(EstadoProducto, {
    message: 'El estado debe ser ACTIVO o INACTIVO',
  })
  @IsNotEmpty({
    message: 'El estado es obligatorio',
  })
  estado: EstadoProducto;
}

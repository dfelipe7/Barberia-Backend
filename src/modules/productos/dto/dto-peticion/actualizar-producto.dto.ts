import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  LIMITE_DESCRIPCION_PRODUCTO,
  LIMITE_NOMBRE_PRODUCTO,
  PRECIO_MAXIMO_PRODUCTO,
  PRECIO_MINIMO_PRODUCTO,
} from '../../productos.constants';

/**
 * Edición parcial de un producto.
 *
 * - Campo omitido: no se modifica.
 * - `descripcion: null` o cadena vacía: se limpia la descripción.
 * - `nombre` o `precio` nulos: inválidos (no se pueden vaciar).
 * - `negocioId`, `estado`, `id` y demás campos internos no se declaran:
 *   el `ValidationPipe` global los rechaza.
 */
export class ActualizarProductoDto {
  @ApiPropertyOptional({
    example: 'Cera para cabello',
    description: 'Nombre del producto. Si se omite, no cambia.',
    maxLength: LIMITE_NOMBRE_PRODUCTO,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITE_NOMBRE_PRODUCTO)
  nombre?: string;

  @ApiPropertyOptional({
    example: 'Cera de fijación fuerte con acabado mate',
    description:
      'Descripción del producto. Si se omite, no cambia. Enviar null o cadena vacía para limpiarla.',
    maxLength: LIMITE_DESCRIPCION_PRODUCTO,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_DESCRIPCION_PRODUCTO)
  descripcion?: string | null;

  @ApiPropertyOptional({
    example: 35000,
    description:
      'Precio del producto. Si se omite, no cambia. Mayor que cero, máximo dos decimales.',
    minimum: PRECIO_MINIMO_PRODUCTO,
    maximum: PRECIO_MAXIMO_PRODUCTO,
  })
  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(PRECIO_MINIMO_PRODUCTO)
  @Max(PRECIO_MAXIMO_PRODUCTO)
  precio?: number;
}

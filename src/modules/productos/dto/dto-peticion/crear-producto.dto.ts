import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  LIMITE_DESCRIPCION_PRODUCTO,
  LIMITE_NOMBRE_PRODUCTO,
  PRECIO_MAXIMO_PRODUCTO,
  PRECIO_MINIMO_PRODUCTO,
} from '../../productos.constants';

/**
 * Datos de texto del producto. La imagen viaja en el mismo formulario
 * multipart (`imagen`) y se valida en el servicio.
 *
 * `precio` llega como texto en `multipart/form-data`; `@Type` lo convierte
 * antes de validar. El cliente no puede enviar `negocioId` ni `estado`: el
 * `ValidationPipe` global rechaza campos no declarados.
 */
export class CrearProductoDto {
  @ApiProperty({
    example: 'Cera para cabello',
    description: 'Nombre del producto',
    maxLength: LIMITE_NOMBRE_PRODUCTO,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITE_NOMBRE_PRODUCTO)
  nombre: string;

  @ApiProperty({
    example: 'Cera de fijación fuerte con acabado mate',
    description: 'Descripción del producto',
    maxLength: LIMITE_DESCRIPCION_PRODUCTO,
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(LIMITE_DESCRIPCION_PRODUCTO)
  descripcion?: string;

  @ApiProperty({
    example: 35000,
    description: 'Precio del producto. Mayor que cero, máximo dos decimales.',
    minimum: PRECIO_MINIMO_PRODUCTO,
    maximum: PRECIO_MAXIMO_PRODUCTO,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(PRECIO_MINIMO_PRODUCTO)
  @Max(PRECIO_MAXIMO_PRODUCTO)
  precio: number;
}

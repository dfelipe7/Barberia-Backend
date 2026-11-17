import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { WeekDay } from '../../../../../generated/prisma/enums';
import {
  PORCENTAJE_MAXIMO_DESCUENTO,
  PORCENTAJE_MINIMO_DESCUENTO,
} from '../../descuentos.constants';

/**
 * Criterio HE-10-HU-03: actualización de un descuento existente.
 *
 * Solo permite modificar `porcentaje` y/o `diasSemana`.
 * El ID del descuento, la asociación con el producto/servicio, el negocio y el
 * estado `activo` NO son modificables a través de este DTO (whitelist/forbid
 * de NestJS rechazará cualquier propiedad extra con 400).
 */
export class ActualizarDescuentoDto {
  @ApiPropertyOptional({
    example: 15.5,
    description:
      'Porcentaje entre 1 y 99 con un máximo de dos decimales. ' +
      'Se rechazan valores con tres o más decimales sin redondear.',
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    {
      message:
        'El porcentaje debe ser un número con un máximo de dos decimales',
    },
  )
  @Min(PORCENTAJE_MINIMO_DESCUENTO)
  @Max(PORCENTAJE_MAXIMO_DESCUENTO)
  @Type(() => Number)
  porcentaje?: number;

  @ApiPropertyOptional({
    enum: WeekDay,
    isArray: true,
    example: [WeekDay.MONDAY, WeekDay.TUESDAY],
    description: 'Uno o más días de la semana en los que aplica el descuento',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(WeekDay, { each: true })
  diasSemana?: WeekDay[];
}

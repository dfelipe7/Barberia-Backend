import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TipoDescuento, WeekDay } from '../../../../../generated/prisma/enums';
import {
  PORCENTAJE_MAXIMO_DESCUENTO,
  PORCENTAJE_MINIMO_DESCUENTO,
} from '../../descuentos.constants';

/**
 * Creación de un descuento sobre un producto o un servicio.
 *
 * El cliente indica el TIPO y el ID del elemento; no envía `negocioId` ni
 * `activo`. El negocio sale del contexto autorizado y el descuento nace
 * inactivo en el servidor.
 */
export class CrearDescuentoDto {
  @ApiProperty({
    enum: TipoDescuento,
    example: TipoDescuento.PRODUCTO,
    description: 'Tipo de elemento al que se aplica el descuento',
  })
  @IsEnum(TipoDescuento)
  tipo: TipoDescuento;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'ID del producto o servicio del negocio activo',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  elementoId: number;

  @ApiProperty({
    example: 10.25,
    minimum: PORCENTAJE_MINIMO_DESCUENTO,
    maximum: PORCENTAJE_MAXIMO_DESCUENTO,
    description: 'Porcentaje entre 1 y 99, con máximo dos decimales',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(PORCENTAJE_MINIMO_DESCUENTO)
  @Max(PORCENTAJE_MAXIMO_DESCUENTO)
  porcentaje: number;

  @ApiProperty({
    enum: WeekDay,
    isArray: true,
    example: [WeekDay.MONDAY, WeekDay.FRIDAY],
    description: 'Uno o más días de la semana en los que aplica el descuento',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(WeekDay, { each: true })
  diasSemana: WeekDay[];
}

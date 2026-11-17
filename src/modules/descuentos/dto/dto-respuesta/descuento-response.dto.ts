import { ApiProperty } from '@nestjs/swagger';
import { TipoDescuento, WeekDay } from '../../../../../generated/prisma/enums';

/** Elemento (producto o servicio) al que pertenece el descuento. */
export class DescuentoElementoResponseDto {
  @ApiProperty({ example: 1, description: 'ID del producto o servicio' })
  id: number;

  @ApiProperty({ example: 'Corte clásico' })
  nombre: string;
}

/** Descuento tal como lo consume el panel administrativo. */
export class DescuentoResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ enum: TipoDescuento, example: TipoDescuento.PRODUCTO })
  tipo: TipoDescuento;

  @ApiProperty({ type: DescuentoElementoResponseDto })
  elemento: DescuentoElementoResponseDto;

  @ApiProperty({ example: 10.25, description: 'Porcentaje de descuento' })
  porcentaje: number;

  @ApiProperty({
    enum: WeekDay,
    isArray: true,
    example: [WeekDay.MONDAY, WeekDay.FRIDAY],
  })
  diasSemana: WeekDay[];

  @ApiProperty({
    example: false,
    description: 'Un descuento recién creado siempre nace inactivo',
  })
  activo: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  creadoEn: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  actualizadoEn: Date;
}

/** Respuesta del alta de un descuento. */
export class DescuentoCreadoResponseDto {
  @ApiProperty({ example: 'Descuento creado correctamente' })
  mensaje: string;

  @ApiProperty({ type: DescuentoResponseDto })
  descuento: DescuentoResponseDto;
}

/** Respuesta de la modificación de un descuento. */
export class DescuentoActualizadoResponseDto {
  @ApiProperty({ example: 'Descuento actualizado correctamente' })
  mensaje: string;

  @ApiProperty({ type: DescuentoResponseDto })
  descuento: DescuentoResponseDto;
}

/** Respuesta del cambio de estado (activar/desactivar) de un descuento. */
export class DescuentoEstadoResponseDto {
  @ApiProperty({ example: 'Descuento activado correctamente' })
  mensaje: string;

  @ApiProperty({ type: DescuentoResponseDto })
  descuento: DescuentoResponseDto;
}

/** Respuesta del listado de descuentos configurados (HE-10-HU-01). */
export class ListaDescuentosResponseDto {
  @ApiProperty({ example: 'Descuentos consultados correctamente' })
  mensaje: string;

  @ApiProperty({ type: [DescuentoResponseDto] })
  descuentos: DescuentoResponseDto[];

  @ApiProperty({ example: 2, description: 'Cantidad total de descuentos' })
  total: number;
}

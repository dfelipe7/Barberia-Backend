import { ApiProperty } from '@nestjs/swagger';
import { TipoDescuento, WeekDay } from '../../../../../generated/prisma/enums';

export type EstadoAplicabilidadDescuento =
  | 'APLICADO'
  | 'SIN_DESCUENTO'
  | 'INACTIVO'
  | 'REQUIERE_FECHA'
  | 'NO_APLICA_DIA';

/** Condiciones registradas del descuento para información previa al cliente. */
export class CondicionesDescuentoDto {
  @ApiProperty({ example: 1, description: 'ID del descuento registrado' })
  id: number;

  @ApiProperty({
    example: true,
    description: 'Estado activo registrado del descuento',
  })
  activo: boolean;

  @ApiProperty({ example: 10.25, description: 'Porcentaje configurado' })
  porcentaje: number;

  @ApiProperty({
    enum: WeekDay,
    isArray: true,
    example: [WeekDay.MONDAY, WeekDay.FRIDAY],
    description: 'Días de la semana en que aplica el descuento',
  })
  diasSemana: WeekDay[];
}

/** Respuesta de evaluación de descuento aplicable (HE-10-HU-05). */
export class DescuentoAplicableResponseDto {
  @ApiProperty({ enum: TipoDescuento, example: TipoDescuento.PRODUCTO })
  tipo: TipoDescuento;

  @ApiProperty({ example: 1, description: 'ID del producto o servicio' })
  elementoId: number;

  @ApiProperty({ example: 'Cera para cabello' })
  nombreElemento: string;

  @ApiProperty({
    example: 'APLICADO',
    enum: [
      'APLICADO',
      'SIN_DESCUENTO',
      'INACTIVO',
      'REQUIERE_FECHA',
      'NO_APLICA_DIA',
    ],
    description:
      'Estado estructurado de la evaluación del descuento para decisiones del frontend',
  })
  estado: EstadoAplicabilidadDescuento;

  @ApiProperty({
    example: true,
    description:
      'Indica si el descuento aplica efectivamente para la fecha/día evaluado (derivado: estado === "APLICADO")',
  })
  aplica: boolean;

  @ApiProperty({
    enum: WeekDay,
    nullable: true,
    example: WeekDay.FRIDAY,
    description:
      'Próximo día de la semana en que aplicará el descuento (cuando estado es NO_APLICA_DIA)',
  })
  proximoDiaAplicable: WeekDay | null;

  @ApiProperty({
    enum: WeekDay,
    nullable: true,
    example: WeekDay.FRIDAY,
    description:
      'Día de la semana evaluado en la zona horaria de la barbería (null si servicio sin fecha)',
  })
  diaEvaluado: WeekDay | null;

  @ApiProperty({
    example: 'America/Bogota',
    description: 'Zona horaria del negocio empleada para la evaluación',
  })
  zonaHoraria: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 10.25,
    description:
      'Porcentaje de descuento aplicado (null si no aplica o no hay fecha)',
  })
  porcentajeAplicado: number | null;

  @ApiProperty({ example: 35000, description: 'Precio original registrado' })
  precioOriginal: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 31412.5,
    description:
      'Precio final tras aplicar el descuento (null si servicio sin fecha)',
  })
  precioFinal: number | null;

  @ApiProperty({
    type: CondicionesDescuentoDto,
    nullable: true,
    description:
      'Condiciones registradas del descuento para referencia (si existe)',
  })
  descuento: CondicionesDescuentoDto | null;

  @ApiProperty({
    example: 'Descuento aplicable para el día evaluado',
    description: 'Mensaje descriptivo del resultado de la evaluación',
  })
  mensaje: string;
}

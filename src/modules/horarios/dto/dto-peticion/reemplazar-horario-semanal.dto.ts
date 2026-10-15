import {
  IsArray,
  IsEnum,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { WeekDay } from '../../../../../generated/prisma/enums';

const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Una franja del horario semanal en la petición de reemplazo.
 * Representa un bloque de 60 minutos de un día de la semana.
 */
export class FranjaHorarioSemanalPeticionDto {
  @ApiProperty({
    enum: WeekDay,
    example: WeekDay.MONDAY,
    description: 'Día de la semana en formato ISO (en inglés)',
  })
  @IsEnum(WeekDay)
  dayOfWeek: WeekDay;

  @ApiProperty({
    example: '09:00',
    description:
      'Hora de inicio en formato HH:mm (24h), alineada a :00 y dentro de la jornada 09:00-20:00',
  })
  @IsString()
  @Matches(REGEX_HORA, { message: 'startTime debe tener el formato HH:mm' })
  startTime: string;

  @ApiProperty({
    example: '10:00',
    description:
      'Hora de fin en formato HH:mm (24h). Debe ser exactamente 60 minutos después del inicio',
  })
  @IsString()
  @Matches(REGEX_HORA, { message: 'endTime debe tener el formato HH:mm' })
  endTime: string;
}

/**
 * Petición para reemplazar por completo el horario semanal del barbero
 * autenticado. La lista enviada se convierte en el horario vigente: un día sin
 * franjas queda sin atención.
 */
export class ReemplazarHorarioSemanalDto {
  @ApiProperty({
    type: [FranjaHorarioSemanalPeticionDto],
    description:
      'Lista completa de franjas de 60 minutos que conforman el horario semanal. Reemplaza por completo el horario anterior. Un día sin franjas queda sin atención.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FranjaHorarioSemanalPeticionDto)
  franjas: FranjaHorarioSemanalPeticionDto[];
}

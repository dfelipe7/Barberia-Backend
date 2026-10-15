import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScheduleBlockReason } from '../../../../../generated/prisma/enums';

const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Petición para crear un periodo de no disponibilidad o un bloqueo temporal
 * (HE08-HU-03 / HE08-HU-05) del barbero autenticado.
 *
 * La identidad del barbero nunca viaja en el cuerpo: se resuelve desde el token.
 */
export class CrearBloqueoHorarioDto {
  @ApiProperty({
    example: '2026-10-20',
    description: 'Fecha de calendario en formato YYYY-MM-DD (día de agenda)',
  })
  @IsString()
  @Matches(REGEX_FECHA, {
    message: 'date debe tener el formato YYYY-MM-DD',
  })
  date: string;

  @ApiProperty({
    example: '15:00',
    description:
      'Hora de inicio en formato HH:mm (24h), alineada a :00 y dentro de la jornada 09:00-20:00',
  })
  @IsString()
  @Matches(REGEX_HORA, { message: 'startTime debe tener el formato HH:mm' })
  startTime: string;

  @ApiProperty({
    example: '16:00',
    description:
      'Hora de fin en formato HH:mm (24h). Debe ser posterior al inicio y componerse de franjas completas de 60 minutos',
  })
  @IsString()
  @Matches(REGEX_HORA, { message: 'endTime debe tener el formato HH:mm' })
  endTime: string;

  @ApiPropertyOptional({
    enum: ScheduleBlockReason,
    example: ScheduleBlockReason.PERSONAL,
    description: 'Razón opcional del bloqueo',
  })
  @IsOptional()
  @IsEnum(ScheduleBlockReason)
  reason?: ScheduleBlockReason;

  @ApiPropertyOptional({
    example: 'Cita personal',
    description:
      'Nota privada del barbero. No se expone en endpoints públicos.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

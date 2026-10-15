import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ScheduleBlockReason } from '../../../../../generated/prisma/enums';

const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Petición para modificar parcialmente un bloqueo (HE08-HU-03 / HE08-HU-05).
 *
 * Todos los campos son opcionales. Enviar `reason: null` o `notes: null`
 * limpia el valor correspondiente; omitir el campo lo deja intacto.
 */
export class ActualizarBloqueoHorarioDto {
  @ApiPropertyOptional({
    example: '2026-10-20',
    description: 'Nueva fecha de calendario en formato YYYY-MM-DD',
  })
  @IsOptional()
  @IsString()
  @Matches(REGEX_FECHA, {
    message: 'date debe tener el formato YYYY-MM-DD',
  })
  date?: string;

  @ApiPropertyOptional({
    example: '15:00',
    description: 'Nueva hora de inicio en formato HH:mm (24h)',
  })
  @IsOptional()
  @IsString()
  @Matches(REGEX_HORA, { message: 'startTime debe tener el formato HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({
    example: '16:00',
    description: 'Nueva hora de fin en formato HH:mm (24h)',
  })
  @IsOptional()
  @IsString()
  @Matches(REGEX_HORA, { message: 'endTime debe tener el formato HH:mm' })
  endTime?: string;

  @ApiPropertyOptional({
    enum: ScheduleBlockReason,
    nullable: true,
    example: ScheduleBlockReason.PERSONAL,
    description: 'Nueva razón del bloqueo, o null para limpiarla',
  })
  @IsOptional()
  @IsEnum(ScheduleBlockReason)
  reason?: ScheduleBlockReason | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Cita personal',
    description: 'Nueva nota privada del barbero, o null para limpiarla',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

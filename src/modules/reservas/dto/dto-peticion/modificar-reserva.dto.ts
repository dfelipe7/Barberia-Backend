import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/** Fecha de calendario del negocio (America/Bogota). */
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Hora de 24 horas `HH:mm` con ceros a la izquierda. */
const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Petición para modificar una reserva propia (HE-04-HU-08).
 *
 * Permite cambiar la fecha, hora o barbero de forma parcial.
 * Los campos son opcionales individualmente, pero se exige al menos uno en el servicio.
 * Cualquier campo adicional no permitido es rechazado por el ValidationPipe global.
 */
export class ModificarReservaDto {
  @ApiPropertyOptional({
    example: 3,
    description:
      'Nuevo ID del barbero (Barbero.id), que debe prestar el servicio de la reserva',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  barberoId?: number;

  @ApiPropertyOptional({
    example: '2026-11-02',
    description:
      'Nueva fecha de calendario de la cita en formato YYYY-MM-DD (America/Bogota)',
  })
  @IsOptional()
  @IsString()
  @Matches(REGEX_FECHA, {
    message: 'La fecha debe tener el formato YYYY-MM-DD',
  })
  fecha?: string;

  @ApiPropertyOptional({
    example: '15:00',
    description: 'Nueva hora de inicio de la franja en formato HH:mm',
  })
  @IsOptional()
  @IsString()
  @Matches(REGEX_HORA, {
    message: 'La hora debe tener el formato HH:mm',
  })
  hora?: string;
}

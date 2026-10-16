import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Fecha de calendario del negocio (America/Bogota) en formato estricto YYYY-MM-DD. */
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parámetros de consulta para la agenda de reservas del barbero autenticado.
 *
 * Requiere estrictamente una fecha de calendario en formato `YYYY-MM-DD`.
 */
export class ConsultaAgendaBarberoDto {
  @ApiProperty({
    example: '2026-11-01',
    description: 'Fecha de la agenda en formato YYYY-MM-DD (America/Bogota)',
  })
  @IsNotEmpty({ message: 'La fecha es obligatoria' })
  @IsString({ message: 'La fecha debe ser un texto' })
  @Matches(REGEX_FECHA, {
    message: 'La fecha debe tener el formato YYYY-MM-DD',
  })
  fecha: string;
}

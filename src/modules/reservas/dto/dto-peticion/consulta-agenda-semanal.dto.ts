import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Fecha de calendario del negocio (America/Bogota) en formato estricto YYYY-MM-DD. */
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parámetros de consulta para la agenda semanal (rango de fechas) del barbero autenticado.
 *
 * Exige las fechas `desde` y `hasta` en formato `YYYY-MM-DD`.
 * El rango máximo permitido entre `desde` y `hasta` es de 7 días consecutivos.
 */
export class ConsultaAgendaSemanalDto {
  @ApiProperty({
    example: '2026-11-02',
    description:
      'Fecha inicial del rango en formato YYYY-MM-DD (America/Bogota)',
  })
  @IsNotEmpty({ message: 'La fecha "desde" es obligatoria' })
  @IsString({ message: 'La fecha "desde" debe ser un texto' })
  @Matches(REGEX_FECHA, {
    message: 'La fecha "desde" debe tener el formato YYYY-MM-DD',
  })
  desde: string;

  @ApiProperty({
    example: '2026-11-08',
    description: 'Fecha final del rango en formato YYYY-MM-DD (America/Bogota)',
  })
  @IsNotEmpty({ message: 'La fecha "hasta" es obligatoria' })
  @IsString({ message: 'La fecha "hasta" debe ser un texto' })
  @Matches(REGEX_FECHA, {
    message: 'La fecha "hasta" debe tener el formato YYYY-MM-DD',
  })
  hasta: string;
}

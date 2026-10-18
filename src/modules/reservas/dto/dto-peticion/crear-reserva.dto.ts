import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Fecha de calendario del negocio (America/Bogota). */
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Hora de 24 horas `HH:mm` con ceros a la izquierda. */
const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Petición de creación de reserva (HE-04-HU-04, HU-10).
 *
 * `barberoId`, `servicioId`, `fecha` y `hora` son obligatorios (CA-02). Los
 * campos de contacto son opcionales en el DTO porque el cliente puede venir
 * autenticado; la obligatoriedad del invitado (nombre + teléfono) se valida en
 * el servicio, que es quien conoce la modalidad (D-01/D-02).
 */
export class CrearReservaDto {
  @ApiProperty({
    example: 3,
    description:
      'ID del barbero (Barbero.id), tal como lo devuelve GET /servicios/:servicioId/barberos',
  })
  @IsInt()
  @Min(1)
  barberoId: number;

  @ApiProperty({ example: 2, description: 'ID del servicio a reservar' })
  @IsInt()
  @Min(1)
  servicioId: number;

  @ApiProperty({
    example: '2026-11-01',
    description:
      'Fecha de calendario de la cita en formato YYYY-MM-DD (America/Bogota)',
  })
  @IsString()
  @Matches(REGEX_FECHA, {
    message: 'La fecha debe tener el formato YYYY-MM-DD',
  })
  fecha: string;

  @ApiProperty({
    example: '14:00',
    description: 'Hora de inicio de la franja en formato HH:mm',
  })
  @IsString()
  @Matches(REGEX_HORA, {
    message: 'La hora debe tener el formato HH:mm',
  })
  hora: string;

  @ApiPropertyOptional({
    example: 'Juan',
    description:
      'Nombre del cliente. Obligatorio para reservar como invitado; se ignora si se envía un token autenticado.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre?: string;

  @ApiPropertyOptional({
    example: 'Pérez',
    description: 'Apellido del cliente (opcional).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido?: string;

  @ApiPropertyOptional({
    example: '3001234567',
    description: 'Número de contacto. Obligatorio para reservar como invitado.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  telefono?: string;
}

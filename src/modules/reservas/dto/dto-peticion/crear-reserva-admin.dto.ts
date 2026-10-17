import {
  IsEmail,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para la creación administrativa de una reserva (HU-13).
 *
 * Permite agendar para:
 * 1. Cliente registrado: se especifica `clienteId` de un cliente existente.
 * 2. Cliente ocasional: no se envía `clienteId`, y se exigen `nombre` y `telefono`.
 */
export class CrearReservaAdminDto {
  @ApiProperty({
    example: 1,
    description: 'Identificador del servicio activo a reservar',
  })
  @IsInt({ message: 'El identificador del servicio debe ser un número entero' })
  @Min(1, { message: 'El identificador del servicio debe ser positivo' })
  servicioId: number;

  @ApiProperty({
    example: 2,
    description: 'Identificador del barbero activo que prestará el servicio',
  })
  @IsInt({ message: 'El identificador del barbero debe ser un número entero' })
  @Min(1, { message: 'El identificador del barbero debe ser positivo' })
  barberoId: number;

  @ApiProperty({
    example: '2026-11-20',
    description: 'Fecha de la cita en formato YYYY-MM-DD (calendario)',
  })
  @IsISO8601(
    { strict: true },
    { message: 'La fecha debe ser válida y tener formato YYYY-MM-DD' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener exactamente formato YYYY-MM-DD',
  })
  fecha: string;

  @ApiProperty({
    example: '14:00',
    description: 'Hora de inicio de la cita en formato HH:mm (24 horas)',
  })
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
    message: 'La hora debe tener formato HH:mm en rango 00:00 a 23:59',
  })
  hora: string;

  @ApiPropertyOptional({
    example: 5,
    description:
      'Identificador de un cliente registrado existente. Si se proporciona, la reserva se asocia a él.',
  })
  @IsOptional()
  @IsInt({ message: 'El identificador del cliente debe ser un número entero' })
  @Min(1, { message: 'El identificador del cliente debe ser positivo' })
  clienteId?: number;

  @ApiPropertyOptional({
    example: 'Juan',
    description:
      'Nombre del cliente ocasional (obligatorio si no se indica clienteId)',
  })
  @IsOptional()
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
  nombre?: string;

  @ApiPropertyOptional({
    example: 'Pérez',
    description: 'Apellido del cliente ocasional (opcional)',
  })
  @IsOptional()
  @IsString({ message: 'El apellido debe ser una cadena de texto' })
  @MaxLength(100, { message: 'El apellido no puede exceder 100 caracteres' })
  apellido?: string;

  @ApiPropertyOptional({
    example: '3001234567',
    description:
      'Número de teléfono de contacto (obligatorio si no se indica clienteId)',
  })
  @IsOptional()
  @IsString({ message: 'El teléfono debe ser una cadena de texto' })
  @MaxLength(20, { message: 'El teléfono no puede exceder 20 caracteres' })
  telefono?: string;

  @ApiPropertyOptional({
    example: 'juan.perez@example.com',
    description: 'Correo electrónico de contacto del cliente ocasional (opcional)',
  })
  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  @MaxLength(150, { message: 'El correo electrónico no puede exceder 150 caracteres' })
  email?: string;
}

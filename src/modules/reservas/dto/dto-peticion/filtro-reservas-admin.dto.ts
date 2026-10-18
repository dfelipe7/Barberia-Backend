import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReservationStatus } from '../../../../../generated/prisma/enums';

/**
 * Filtros para la consulta administrativa de reservas por SUPERADMIN.
 */
export class FiltroReservasAdminDto {
  @ApiPropertyOptional({
    example: '2026-11-20',
    description: 'Filtra reservas para una fecha puntual (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'La fecha debe tener formato YYYY-MM-DD' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener formato YYYY-MM-DD',
  })
  fecha?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Fecha inicial del rango de búsqueda (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'La fecha "desde" debe tener formato YYYY-MM-DD' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha "desde" debe tener formato YYYY-MM-DD',
  })
  desde?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Fecha final del rango de búsqueda (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'La fecha "hasta" debe tener formato YYYY-MM-DD' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha "hasta" debe tener formato YYYY-MM-DD',
  })
  hasta?: string;

  @ApiPropertyOptional({
    example: 2,
    description: 'Identificador del barbero para filtrar sus reservas',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El identificador del barbero debe ser un número entero' })
  @Min(1, { message: 'El identificador del barbero debe ser positivo' })
  barberoId?: number;

  @ApiPropertyOptional({
    enum: ReservationStatus,
    example: ReservationStatus.CONFIRMED,
    description:
      'Estado de la reserva a filtrar (PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED)',
  })
  @IsOptional()
  @IsEnum(ReservationStatus, {
    message: 'El estado de la reserva no es válido',
  })
  estado?: ReservationStatus;

  @ApiPropertyOptional({
    example: 7,
    description:
      'Identificador del cliente para consultar su historial de reservas',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El identificador del cliente debe ser un número entero' })
  @Min(1, { message: 'El identificador del cliente debe ser positivo' })
  clienteId?: number;
}

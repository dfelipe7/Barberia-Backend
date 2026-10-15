import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query de la consulta pública de disponibilidad de un barbero.
 *
 * El `barberoId` viaja en la ruta; aquí solo se resuelven `servicioId` (opcional)
 * y `fecha` (obligatoria).
 */
export class ConsultaDisponibilidadDto {
  @ApiPropertyOptional({
    example: 2,
    description:
      'ID del servicio a validar. Si se informa, el barbero debe ofrecerlo (estar asignado) y el servicio debe estar ACTIVO.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'servicioId debe ser un número entero' })
  @Min(1, { message: 'servicioId debe ser mayor o igual a 1' })
  servicioId?: number;

  @ApiProperty({
    example: '2026-10-20',
    description: 'Fecha de calendario en formato YYYY-MM-DD (día de agenda)',
  })
  @IsString()
  @Matches(REGEX_FECHA, { message: 'fecha debe tener el formato YYYY-MM-DD' })
  fecha: string;
}

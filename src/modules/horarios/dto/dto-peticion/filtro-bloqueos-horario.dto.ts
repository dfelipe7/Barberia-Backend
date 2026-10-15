import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ScheduleBlockStatus } from '../../../../../generated/prisma/enums';

const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Filtros opcionales para listar los bloqueos del barbero autenticado.
 */
export class FiltroBloqueosHorarioDto {
  @ApiPropertyOptional({
    example: '2026-10-20',
    description: 'Filtra por fecha de calendario (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsString()
  @Matches(REGEX_FECHA, {
    message: 'fecha debe tener el formato YYYY-MM-DD',
  })
  fecha?: string;

  @ApiPropertyOptional({
    enum: ScheduleBlockStatus,
    example: ScheduleBlockStatus.ACTIVE,
    description: 'Filtra por estado del bloqueo',
  })
  @IsOptional()
  @IsEnum(ScheduleBlockStatus)
  status?: ScheduleBlockStatus;
}

import { ApiProperty } from '@nestjs/swagger';
import { WeekDay } from '../../../../../generated/prisma/enums';

/**
 * Representa una franja de 60 minutos del horario semanal vigente de un barbero.
 */
export class FranjaHorarioSemanalDto {
  @ApiProperty({
    enum: WeekDay,
    example: WeekDay.MONDAY,
    description: 'Día de la semana en formato ISO (en inglés)',
  })
  dayOfWeek: WeekDay;

  @ApiProperty({ example: '09:00', description: 'Hora de inicio (HH:mm)' })
  startTime: string;

  @ApiProperty({ example: '10:00', description: 'Hora de fin (HH:mm)' })
  endTime: string;
}

/**
 * DTO de respuesta para la consulta y el reemplazo del horario semanal.
 * Utilizado en:
 * - GET /usuarios/me/barbero/horario-semanal
 * - PUT /usuarios/me/barbero/horario-semanal
 */
export class HorarioSemanalResponseDto {
  @ApiProperty({ example: 7, description: 'ID del barbero (perfil Barbero)' })
  barberoId: number;

  @ApiProperty({
    type: [FranjaHorarioSemanalDto],
    description: 'Franjas de 60 minutos del horario semanal vigente',
  })
  franjas: FranjaHorarioSemanalDto[];
}

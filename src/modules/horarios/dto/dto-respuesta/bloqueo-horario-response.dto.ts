import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ScheduleBlockReason,
  ScheduleBlockStatus,
} from '../../../../../generated/prisma/enums';

/**
 * Representación pública de un bloqueo de horario para los endpoints `me`.
 *
 * `notes` es una nota privada del barbero dueño: solo se devuelve en endpoints
 * autenticados (`/usuarios/me/barbero/...`) y nunca debe exponerse en
 * respuestas públicas. No se incluye `reactivatedBy` (identificador interno).
 */
export class BloqueoHorarioResponseDto {
  @ApiProperty({ example: 1, description: 'ID del bloqueo' })
  id: number;

  @ApiProperty({
    example: '2026-10-20',
    description: 'Fecha del bloqueo (YYYY-MM-DD)',
  })
  date: string;

  @ApiProperty({ example: '15:00', description: 'Hora de inicio (HH:mm)' })
  startTime: string;

  @ApiProperty({ example: '16:00', description: 'Hora de fin (HH:mm)' })
  endTime: string;

  @ApiPropertyOptional({
    enum: ScheduleBlockReason,
    nullable: true,
    example: ScheduleBlockReason.PERSONAL,
    description: 'Razón del bloqueo (opcional)',
  })
  reason: ScheduleBlockReason | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Cita personal',
    description: 'Nota privada del barbero (solo en endpoints autenticados)',
  })
  notes: string | null;

  @ApiProperty({
    enum: ScheduleBlockStatus,
    example: ScheduleBlockStatus.ACTIVE,
    description:
      'Estado del bloqueo. Solo ACTIVE excluye disponibilidad; REACTIVATED y CANCELLED conservan el historial pero ya no bloquean.',
  })
  status: ScheduleBlockStatus;

  @ApiProperty({
    example: '2026-10-18T14:00:00.000Z',
    description: 'Marca de creación (ISO 8601)',
  })
  createdAt: string;

  @ApiProperty({
    example: '2026-10-18T14:00:00.000Z',
    description: 'Marca de última actualización (ISO 8601)',
  })
  updatedAt: string;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-10-21T15:30:00.000Z',
    description:
      'Marca de reactivación/liberación (ISO 8601) cuando el estado es REACTIVATED',
  })
  reactivatedAt: string | null;
}

/**
 * Respuesta de las operaciones que mutan un bloqueo
 * (crear, modificar, cancelar y reactivar).
 */
export class BloqueoHorarioAccionResponseDto {
  @ApiProperty({
    example: 'Bloqueo creado correctamente',
    description: 'Mensaje descriptivo de la operación',
  })
  mensaje: string;

  @ApiProperty({
    type: BloqueoHorarioResponseDto,
    description: 'Bloqueo resultante de la operación',
  })
  block: BloqueoHorarioResponseDto;
}

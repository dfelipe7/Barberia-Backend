import { ApiProperty } from '@nestjs/swagger';
import { ReservationStatus } from '../../../../../generated/prisma/enums';

/**
 * Respuesta a la finalización de una reserva (SCRUM-277).
 */
export class ReservaCompletadaResponseDto {
  @ApiProperty({ example: 'Reserva completada correctamente' })
  mensaje: string;

  @ApiProperty({
    example: 42,
    description: 'Identificador único de la reserva',
  })
  id: number;

  @ApiProperty({
    example: ReservationStatus.COMPLETED,
    enum: ReservationStatus,
    description: 'Estado completado de la reserva',
  })
  estado: ReservationStatus;
}

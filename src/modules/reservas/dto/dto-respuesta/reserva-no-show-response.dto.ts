import { ApiProperty } from '@nestjs/swagger';
import { ReservationStatus } from '../../../../../generated/prisma/enums';

/**
 * Respuesta al marcar una reserva como no asistida (NO_SHOW).
 */
export class ReservaNoShowResponseDto {
  @ApiProperty({ example: 'Reserva marcada como no asistida' })
  mensaje: string;

  @ApiProperty({
    example: 42,
    description: 'Identificador único de la reserva',
  })
  id: number;

  @ApiProperty({
    example: ReservationStatus.NO_SHOW,
    enum: ReservationStatus,
    description: 'Estado no asistido de la reserva',
  })
  estado: ReservationStatus;
}

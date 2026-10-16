import { ApiProperty } from '@nestjs/swagger';
import { ReservationStatus } from '../../../../../generated/prisma/enums';

/**
 * Respuesta a la cancelación de una reserva (HE-04-HU-09).
 */
export class ReservaCanceladaResponseDto {
  @ApiProperty({ example: 'Reserva cancelada correctamente' })
  mensaje: string;

  @ApiProperty({ example: 42, description: 'Identificador único de la reserva' })
  id: number;

  @ApiProperty({
    example: ReservationStatus.CANCELLED,
    enum: ReservationStatus,
    description: 'Estado cancelado de la reserva',
  })
  estado: ReservationStatus;
}

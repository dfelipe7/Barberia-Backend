import { ApiProperty } from '@nestjs/swagger';
import { ReservationStatus } from '../../../../../generated/prisma/enums';
import {
  BarberoReservaDto,
  ServicioReservaDto,
} from './reserva-creada-response.dto';

/**
 * Respuesta a la modificación exitosa de una reserva (HE-04-HU-08).
 * Contiene el mensaje de confirmación y los datos actualizados de la cita.
 */
export class ReservaModificadaResponseDto {
  @ApiProperty({ example: 'Reserva modificada correctamente' })
  mensaje: string;

  @ApiProperty({
    example: 42,
    description: 'Identificador único de la reserva',
  })
  id: number;

  @ApiProperty({
    example: ReservationStatus.PENDING,
    enum: ReservationStatus,
    description: 'Estado de la reserva',
  })
  estado: ReservationStatus;

  @ApiProperty({
    example: '2026-11-02',
    description: 'Fecha de la cita (YYYY-MM-DD)',
  })
  fecha: string;

  @ApiProperty({
    example: '15:00',
    description: 'Hora de inicio de la franja (HH:mm)',
  })
  hora: string;

  @ApiProperty({
    example: '16:00',
    description: 'Hora de fin de la franja (HH:mm)',
  })
  horaFin: string;

  @ApiProperty({
    example: 50000,
    description: 'Precio aplicado a la reserva (histórico)',
  })
  precio: number;

  @ApiProperty({ type: BarberoReservaDto })
  barbero: BarberoReservaDto;

  @ApiProperty({ type: ServicioReservaDto })
  servicio: ServicioReservaDto;
}

import { ApiProperty } from '@nestjs/swagger';
import { ReservationStatus } from '../../../../../generated/prisma/enums';
import { BarberoReservaDto } from './reserva-creada-response.dto';

/** Resumen del servicio dentro de una reserva del cliente (sin duración). */
export class ServicioResumenDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'Corte de cabello' })
  nombre: string;
}

/**
 * Reserva vista por su propio cliente (HE-04-HU-06 y HU-07).
 *
 * Expone servicio, barbero, fecha, hora y estado; además el precio aplicado
 * (histórico, calculado por el servidor). No incluye el `clienteId` ni datos
 * internos de otras reservas.
 */
export class ReservaClienteDto {
  @ApiProperty({
    example: 42,
    description: 'Identificador único de la reserva',
  })
  id: number;

  @ApiProperty({
    example: ReservationStatus.PENDING,
    enum: ReservationStatus,
    description: 'Estado actual de la reserva',
  })
  estado: ReservationStatus;

  @ApiProperty({
    example: '2026-11-01',
    description: 'Fecha de la cita (YYYY-MM-DD)',
  })
  fecha: string;

  @ApiProperty({ example: '14:00', description: 'Hora de inicio (HH:mm)' })
  hora: string;

  @ApiProperty({ example: '15:00', description: 'Hora de fin (HH:mm)' })
  horaFin: string;

  @ApiProperty({
    example: 50000,
    description:
      'Precio aplicado al crear la reserva (histórico). Si la reserva es anterior al registro del precio, se usa el precio vigente del servicio.',
  })
  precio: number;

  @ApiProperty({ type: BarberoReservaDto })
  barbero: BarberoReservaDto;

  @ApiProperty({ type: ServicioResumenDto })
  servicio: ServicioResumenDto;
}

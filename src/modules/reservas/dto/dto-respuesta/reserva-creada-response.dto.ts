import { ApiProperty } from '@nestjs/swagger';
import { ReservationStatus } from '../../../../../generated/prisma/enums';

/** Barbero confirmado en la reserva (datos mínimos, sin información sensible). */
export class BarberoReservaDto {
  @ApiProperty({ example: 3, description: 'ID del barbero (Barbero.id)' })
  id: number;

  @ApiProperty({ example: 'Carlos' })
  nombre: string;

  @ApiProperty({ example: 'Gómez' })
  apellido: string;
}

/** Servicio confirmado en la reserva, con el precio y la duración vigentes al crearla. */
export class ServicioReservaDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'Corte de cabello' })
  nombre: string;

  @ApiProperty({ example: 50000, description: 'Precio vigente del servicio' })
  precio: number;

  @ApiProperty({ example: 30, description: 'Duración vigente en minutos' })
  duracionMinutos: number;
}

/**
 * Confirmación de creación de reserva (HE-04-HU-10): mensaje, identificador
 * único y datos principales de la cita.
 */
export class ReservaCreadaResponseDto {
  @ApiProperty({ example: 'Reserva creada exitosamente' })
  mensaje: string;

  @ApiProperty({ example: 42, description: 'Identificador único de la reserva' })
  id: number;

  @ApiProperty({
    example: ReservationStatus.PENDING,
    enum: ReservationStatus,
    description: 'Estado inicial de la reserva',
  })
  estado: ReservationStatus;

  @ApiProperty({ example: '2026-11-01', description: 'Fecha de la cita (YYYY-MM-DD)' })
  fecha: string;

  @ApiProperty({ example: '14:00', description: 'Hora de inicio de la franja (HH:mm)' })
  hora: string;

  @ApiProperty({ example: '15:00', description: 'Hora de fin de la franja (HH:mm)' })
  horaFin: string;

  @ApiProperty({ type: BarberoReservaDto })
  barbero: BarberoReservaDto;

  @ApiProperty({ type: ServicioReservaDto })
  servicio: ServicioReservaDto;
}

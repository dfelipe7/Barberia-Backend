import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReservationStatus } from '../../../../../generated/prisma/enums';

export class BarberoReservaAdminDto {
  @ApiProperty({ example: 2, description: 'ID del barbero' })
  id: number;

  @ApiProperty({ example: 'Duvan', description: 'Nombre del barbero' })
  nombre: string;

  @ApiProperty({ example: 'Armero', description: 'Apellido del barbero' })
  apellido: string;
}

export class ClienteReservaAdminDto {
  @ApiProperty({ example: 5, description: 'ID del cliente en base de datos' })
  id: number;

  @ApiProperty({ example: 'Juan', description: 'Nombre del cliente' })
  nombre: string;

  @ApiPropertyOptional({
    example: 'Pérez',
    description: 'Apellido del cliente',
  })
  apellido?: string | null;

  @ApiPropertyOptional({
    example: '3001234567',
    description: 'Teléfono de contacto del cliente',
  })
  telefono?: string | null;

  @ApiPropertyOptional({
    example: 'juan@example.com',
    description: 'Correo de contacto del cliente',
  })
  email?: string | null;

  @ApiProperty({
    example: true,
    description:
      'Indica si el cliente posee cuenta registrada o si es un cliente ocasional',
  })
  esRegistrado: boolean;
}

export class ServicioReservaAdminDto {
  @ApiProperty({ example: 1, description: 'ID del servicio' })
  id: number;

  @ApiProperty({ example: 'Corte Clásico', description: 'Nombre del servicio' })
  nombre: string;

  @ApiProperty({ example: 25000, description: 'Precio aplicado de la reserva' })
  precio: number;

  @ApiProperty({ example: 60, description: 'Duración estimada en minutos' })
  duracionMinutos: number;
}

/**
 * DTO para la respuesta detallada de una reserva en la administración global.
 */
export class ReservaAdminDetalleDto {
  @ApiProperty({
    example: 42,
    description: 'Identificador único de la reserva',
  })
  id: number;

  @ApiProperty({
    example: '2026-11-20',
    description: 'Fecha agendada (YYYY-MM-DD)',
  })
  fecha: string;

  @ApiProperty({
    example: '14:00',
    description: 'Hora de inicio de la cita (HH:mm)',
  })
  hora: string;

  @ApiProperty({
    example: '15:00',
    description: 'Hora de fin estimada de la cita (HH:mm)',
  })
  horaFin: string;

  @ApiProperty({
    enum: ReservationStatus,
    example: ReservationStatus.CONFIRMED,
    description: 'Estado de la reserva',
  })
  estado: ReservationStatus;

  @ApiProperty({
    example: 25000,
    description: 'Precio congelado o aplicado a la reserva',
  })
  precio: number;

  @ApiProperty({
    example: '2026-10-16T20:30:00.000Z',
    description: 'Fecha y hora de creación',
  })
  createdAt: Date;

  @ApiProperty({
    type: BarberoReservaAdminDto,
    description: 'Barbero asignado',
  })
  barbero: BarberoReservaAdminDto;

  @ApiProperty({
    type: ClienteReservaAdminDto,
    description: 'Datos del cliente',
  })
  cliente: ClienteReservaAdminDto;

  @ApiProperty({
    type: ServicioReservaAdminDto,
    description: 'Datos del servicio',
  })
  servicio: ServicioReservaAdminDto;
}

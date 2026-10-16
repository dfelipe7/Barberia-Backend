import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReservationStatus } from '../../../../../generated/prisma/enums';

/**
 * Datos del cliente en la agenda del barbero.
 * Contiene información de contacto para la cita (aplica tanto a registrados como a invitados).
 * No expone identificadores internos de autenticación, Google ID ni tokens.
 */
export class ClienteAgendaDto {
  @ApiProperty({ example: 'Carlos', description: 'Nombre del cliente' })
  nombre: string;

  @ApiPropertyOptional({
    example: 'Pérez',
    nullable: true,
    description: 'Apellido del cliente si fue registrado',
  })
  apellido?: string | null;

  @ApiPropertyOptional({
    example: '3001234567',
    nullable: true,
    description: 'Teléfono de contacto del cliente si está disponible',
  })
  telefono?: string | null;
}

/**
 * Resumen del servicio asociado a la cita en la agenda.
 */
export class ServicioAgendaDto {
  @ApiProperty({ example: 2, description: 'ID del servicio' })
  id: number;

  @ApiProperty({ example: 'Corte de cabello', description: 'Nombre del servicio' })
  nombre: string;

  @ApiProperty({
    example: 45,
    description: 'Duración estimada del servicio en minutos',
  })
  duracionMinutos: number;
}

/**
 * Cita individual en la agenda diaria del barbero.
 */
export class CitaAgendaBarberoDto {
  @ApiProperty({
    example: 42,
    description: 'Identificador único de la reserva',
  })
  id: number;

  @ApiProperty({
    example: '2026-11-01',
    description: 'Fecha de la cita en formato YYYY-MM-DD',
  })
  fecha: string;

  @ApiProperty({
    example: '14:00',
    description: 'Hora de inicio de la cita en formato HH:mm',
  })
  hora: string;

  @ApiProperty({
    example: '15:00',
    description: 'Hora de finalización de la cita en formato HH:mm',
  })
  horaFin: string;

  @ApiProperty({
    example: ReservationStatus.CONFIRMED,
    enum: ReservationStatus,
    description: 'Estado de la reserva',
  })
  estado: ReservationStatus;

  @ApiProperty({
    example: 50000,
    description:
      'Precio acordado al reservar (histórico) o precio vigente del servicio',
  })
  precio: number;

  @ApiProperty({
    type: ClienteAgendaDto,
    description: 'Datos del cliente que reservó la cita',
  })
  cliente: ClienteAgendaDto;

  @ApiProperty({
    type: ServicioAgendaDto,
    description: 'Datos del servicio solicitado',
  })
  servicio: ServicioAgendaDto;
}

/**
 * Respuesta de la agenda diaria del barbero.
 */
export class AgendaBarberoResponseDto {
  @ApiProperty({
    example: '2026-11-01',
    description: 'Fecha consultada en formato YYYY-MM-DD',
  })
  fecha: string;

  @ApiProperty({
    type: [CitaAgendaBarberoDto],
    description: 'Lista de reservas activas del barbero para la fecha solicitada, ordenadas cronológicamente',
  })
  reservas: CitaAgendaBarberoDto[];
}

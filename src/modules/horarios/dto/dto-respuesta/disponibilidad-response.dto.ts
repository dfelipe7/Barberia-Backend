import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoFranja } from '../../common/estado-franja';

/**
 * Franja disponible en la vista pública. No expone el motivo de indisponibilidad
 * de las demás franjas (reserva, bloqueo, cierre ni reglas privadas): solo se
 * devuelven las franjas efectivamente disponibles.
 */
export class FranjaDisponibleDto {
  @ApiProperty({ example: '09:00', description: 'Hora de inicio (HH:mm)' })
  startTime: string;

  @ApiProperty({ example: '10:00', description: 'Hora de fin (HH:mm)' })
  endTime: string;

  @ApiProperty({
    example: true,
    description:
      'Indica que la franja está disponible. La vista pública solo incluye franjas con este valor en true.',
  })
  available: boolean;
}

/**
 * Respuesta pública de disponibilidad (spec §9.8). Consumida por HE-04 y por el
 * catálogo del cliente. Nunca revela reservas, bloqueos, cierres ni notas.
 */
export class DisponibilidadPublicaResponseDto {
  @ApiProperty({ example: '2026-10-20', description: 'Fecha consultada' })
  fecha: string;

  @ApiProperty({
    example: 'America/Bogota',
    description: 'Zona horaria de negocio usada para resolver las franjas',
  })
  timeZone: string;

  @ApiProperty({ example: 3, description: 'ID del barbero (Barbero.id)' })
  barberoId: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 2,
    description: 'ID del servicio validado, o null si no se informó',
  })
  servicioId: number | null;

  @ApiProperty({
    type: [FranjaDisponibleDto],
    description: 'Franjas disponibles de la jornada (09:00-20:00)',
  })
  slots: FranjaDisponibleDto[];
}

/**
 * Franja con su estado efectivo, para la consulta autenticada del propio
 * barbero y para la integración de HE-04. Los estados nunca se exponen en la
 * vista pública.
 */
export class FranjaDisponibilidadDetalladaDto {
  @ApiProperty({ example: '09:00', description: 'Hora de inicio (HH:mm)' })
  startTime: string;

  @ApiProperty({ example: '10:00', description: 'Hora de fin (HH:mm)' })
  endTime: string;

  @ApiProperty({
    enum: EstadoFranja,
    example: EstadoFranja.AVAILABLE,
    description:
      'Estado efectivo de la franja. La prelación es OUTSIDE_SCHEDULE > GENERAL_CLOSURE > BLOCKED > RESERVED > AVAILABLE.',
  })
  status: EstadoFranja;
}

/**
 * Respuesta detallada de disponibilidad. Reservada a endpoints autenticados del
 * propio barbero y al consumo interno de HE-04; no debe publicarse sin control
 * de acceso porque revela por qué una franja no está disponible.
 */
export class DisponibilidadDetalladaResponseDto {
  @ApiProperty({ example: '2026-10-20', description: 'Fecha consultada' })
  fecha: string;

  @ApiProperty({
    example: 'America/Bogota',
    description: 'Zona horaria de negocio',
  })
  timeZone: string;

  @ApiProperty({ example: 3, description: 'ID del barbero (Barbero.id)' })
  barberoId: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 2,
    description: 'ID del servicio validado, o null si no se informó',
  })
  servicioId: number | null;

  @ApiProperty({
    type: [FranjaDisponibilidadDetalladaDto],
    description: 'Todas las franjas de la jornada con su estado efectivo',
  })
  slots: FranjaDisponibilidadDetalladaDto[];
}

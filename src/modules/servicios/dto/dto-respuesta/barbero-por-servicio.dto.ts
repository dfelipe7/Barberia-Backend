import { ApiProperty } from '@nestjs/swagger';

/**
 * Barbero ACTIVO que tiene habilitado un servicio (HE-04-HU-02).
 *
 * `id` es el identificador del perfil `Barbero.id` (no el `Usuario.id`): es la
 * misma clave que espera `GET /usuarios/barberos/:barberoId/disponibilidad`, de
 * modo que el cliente puede encadenar la selección barbero → disponibilidad sin
 * traducir identificadores. No expone datos sensibles (email, comisión).
 */
export class BarberoPorServicioDto {
  @ApiProperty({
    example: 3,
    description:
      'ID del barbero (Barbero.id). Es el valor que consume el endpoint de disponibilidad.',
  })
  id: number;

  @ApiProperty({ example: 'Carlos', description: 'Nombre del barbero' })
  nombre: string;

  @ApiProperty({ example: 'Gómez', description: 'Apellido del barbero' })
  apellido: string;

  @ApiProperty({
    example: '/uploads/barberos/carlos.jpg',
    description: 'Foto de perfil del barbero',
    required: false,
    nullable: true,
  })
  fotoUrl?: string | null;
}

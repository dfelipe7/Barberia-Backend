import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO de respuesta pública para el catálogo de barberos.
 * Utilizado en: GET /usuarios/barberos (vista pública de reserva)
 *
 * Excluye datos sensibles como correo, porcentaje de comisión y estado de roles.
 */
export class BarberoCatalogoDto {
  @ApiProperty({ example: 1, description: 'ID único del barbero' })
  id: number;

  @ApiProperty({ example: 'Carlos', description: 'Nombre del barbero' })
  nombre: string;

  @ApiProperty({ example: 'Gómez', description: 'Apellido del barbero' })
  apellido: string;

  @ApiProperty({ example: '3001234567', description: 'Teléfono de contacto' })
  telefono: string;

  @ApiProperty({
    example: '/uploads/barberos/carlos.jpg',
    description: 'URL de la foto de perfil del barbero',
    required: false,
  })
  fotoUrl?: string | null;
}

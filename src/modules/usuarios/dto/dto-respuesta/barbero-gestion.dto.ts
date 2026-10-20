import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO de respuesta para la vista de gestión de barberos.
 * Utilizado en: GET /usuarios/barberos/gestion
 *
 * Aplana los datos anidados de Prisma (Barbero → Usuario → Administrador)
 * y calcula campos derivados como esAdministrador y esSuperAdmin
 * para que el Frontend pueda renderizar la tabla de gestión directamente.
 */
export class BarberoGestionDto {
  @ApiProperty({
    example: 3,
    description:
      'ID del USUARIO (identidad global de la persona). Es la clave que consumen las rutas de gestión de usuarios y de estado de la cuenta.',
  })
  id: number;

  @ApiProperty({
    example: 7,
    description:
      'ID del perfil de BARBERO (Barbero.id) dentro de la barbería. Es la clave que consumen la asignación de servicios a barberos y la disponibilidad.',
  })
  barberoId: number;

  @ApiProperty({ example: 'Carlos', description: 'Nombre del barbero' })
  nombre: string;

  @ApiProperty({ example: 'Gómez', description: 'Apellido del barbero' })
  apellido: string;

  @ApiProperty({
    example: 'carlos@barberia.com',
    description: 'Correo electrónico del barbero',
  })
  email: string;

  @ApiProperty({ example: '3001234567', description: 'Teléfono del barbero' })
  telefono: string;

  @ApiProperty({
    example: 50,
    description: 'Porcentaje de comisión del barbero',
  })
  porcentajeComision: number;

  @ApiProperty({
    example: 'ACTIVO',
    description: 'Estado del rol de barbero (ACTIVO o INACTIVO)',
  })
  estado: string;

  @ApiProperty({
    example: '/uploads/barberos/carlos.jpg',
    description: 'URL de la foto del barbero',
    required: false,
  })
  fotoUrl?: string | null;

  @ApiProperty({
    example: true,
    description:
      'Indica si el usuario también tiene rol de Administrador activo',
  })
  esAdministrador: boolean;

  @ApiProperty({
    example: false,
    description: 'Indica si el usuario es SUPERADMIN',
  })
  esSuperAdmin: boolean;

  @ApiProperty({
    example: 'ACTIVO',
    description: 'Estado del rol de administrador (si aplica)',
    required: false,
  })
  estadoAdmin?: string;

  @ApiProperty({
    example: 'ACTIVO',
    description: 'Estado global de la cuenta del usuario',
  })
  estadoGlobal: string;
}

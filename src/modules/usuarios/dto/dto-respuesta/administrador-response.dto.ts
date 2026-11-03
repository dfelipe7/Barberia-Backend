import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO de respuesta para la lista de administradores.
 * Utilizado en: GET /usuarios/administradores
 *
 * Aplana los datos anidados de Prisma (Administrador → Usuario → Barbero)
 * para que el Frontend pueda renderizar la tabla de gestión de administradores.
 */
export class AdministradorResponseDto {
  @ApiProperty({ example: 3, description: 'ID del usuario' })
  id: number;

  @ApiProperty({ example: 'María', description: 'Nombre del administrador' })
  nombre: string;

  @ApiProperty({ example: 'López', description: 'Apellido del administrador' })
  apellido: string;

  @ApiProperty({
    example: 'maria@barberia.com',
    description: 'Correo electrónico',
  })
  email: string;

  @ApiProperty({
    example: 'ACTIVO',
    description: 'Estado global de la cuenta del usuario',
  })
  estado: string;

  @ApiProperty({
    example: 'ACTIVO',
    description: 'Estado del rol de administrador',
  })
  estadoAdmin: string;

  @ApiProperty({
    example: true,
    description: 'Indica si el usuario también tiene rol de Barbero',
  })
  esBarbero: boolean;

  @ApiProperty({
    example: 'ACTIVO',
    description: 'Estado del rol de barbero (si aplica)',
    required: false,
  })
  estadoBarbero?: string;

  @ApiProperty({
    example: true,
    description:
      'Indica si el administrador es Superadministrador de la barbería',
    required: false,
  })
  esSuperAdmin?: boolean;
}

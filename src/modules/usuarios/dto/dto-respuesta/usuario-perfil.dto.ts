import { ApiProperty } from '@nestjs/swagger';

/**
 * Subestructura del perfil de administrador dentro de la respuesta de usuario.
 */
export class AdminPerfilDto {
    @ApiProperty({ example: 1, description: 'ID del registro de administrador' })
    id: number;

    @ApiProperty({ example: 'ACTIVO', description: 'Estado del rol de administrador' })
    estado: string;
}

/**
 * Subestructura del perfil de barbero dentro de la respuesta de usuario.
 */
export class BarberoPerfilDto {
    @ApiProperty({ example: 1, description: 'ID del registro de barbero' })
    id: number;

    @ApiProperty({ example: '3001234567', description: 'Teléfono del barbero' })
    telefono: string;

    @ApiProperty({ example: 50, description: 'Porcentaje de comisión' })
    porcentajeComision: number;

    @ApiProperty({ example: '/uploads/barberos/foto.jpg', description: 'URL de la foto', required: false })
    fotoUrl?: string | null;

    @ApiProperty({ example: 'ACTIVO', description: 'Estado del rol de barbero' })
    estado: string;
}

/**
 * DTO de respuesta para el perfil de un usuario.
 * Utilizado en:
 * - GET /usuarios/me (perfil del usuario autenticado)
 * - GET /usuarios/:id (perfil de un usuario específico)
 *
 * Incluye los subobjetos de administrador y barbero tal como vienen de Prisma,
 * ya que el Frontend necesita saber los estados de cada rol para renderizar
 * la interfaz de gestión correctamente.
 */
export class UsuarioPerfilDto {
    @ApiProperty({ example: 1, description: 'ID del usuario' })
    id: number;

    @ApiProperty({ example: 'carlos@barberia.com', description: 'Correo electrónico' })
    email: string;

    @ApiProperty({ example: 'Carlos', description: 'Nombre del usuario' })
    nombre: string;

    @ApiProperty({ example: 'Gómez', description: 'Apellido del usuario' })
    apellido: string;

    @ApiProperty({ example: 'ADMINISTRADOR', description: 'Rol principal del usuario' })
    rol: string;

    @ApiProperty({ example: 'ACTIVO', description: 'Estado global de la cuenta' })
    estado: string;

    @ApiProperty({ type: AdminPerfilDto, description: 'Perfil de administrador (si tiene el rol)', required: false })
    administrador?: AdminPerfilDto | null;

    @ApiProperty({ type: BarberoPerfilDto, description: 'Perfil de barbero (si tiene el rol)', required: false })
    barbero?: BarberoPerfilDto | null;
}

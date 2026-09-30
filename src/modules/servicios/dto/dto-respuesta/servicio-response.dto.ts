import { ApiProperty } from '@nestjs/swagger';

/**
 * Representa un barbero asignado a un servicio dentro de la respuesta del catálogo.
 * Solo incluye los datos necesarios para que el Frontend muestre al barbero
 * sin exponer información sensible (email, comisión, keycloakId, etc.).
 */
export class BarberoEnServicioDto {
    @ApiProperty({ example: 3, description: 'ID del usuario (barbero)' })
    id: number;

    @ApiProperty({ example: 'Carlos', description: 'Nombre del barbero' })
    nombre: string;

    @ApiProperty({ example: 'Gómez', description: 'Apellido del barbero' })
    apellido: string;

    @ApiProperty({ example: '/uploads/barberos/carlos.jpg', description: 'Foto del barbero', required: false })
    fotoUrl?: string | null;
}

/**
 * DTO de respuesta para los endpoints que retornan servicios.
 * Utilizado en:
 * - GET /servicios (catálogo público)
 * - GET /servicios/gestion (panel administrativo)
 * - GET /servicios/:id (detalle de un servicio)
 * - GET /servicios/barbero/:barberoId (servicios de un barbero)
 *
 * Aplana la estructura anidada de Prisma (BarberoServicio → Barbero → Usuario)
 * para que el Frontend reciba una lista limpia de barberos por servicio.
 */
export class ServicioResponseDto {
    @ApiProperty({ example: 1, description: 'ID único del servicio' })
    id: number;

    @ApiProperty({ example: 'Corte de cabello', description: 'Nombre del servicio' })
    nombre: string;

    @ApiProperty({ example: 'Corte clásico con tijera y máquina', description: 'Descripción del servicio', required: false })
    descripcion?: string | null;

    @ApiProperty({ example: 15000, description: 'Precio del servicio en pesos' })
    precio: number;

    @ApiProperty({ example: 30, description: 'Duración del servicio en minutos' })
    duracionMinutos: number;

    @ApiProperty({ example: '/uploads/servicios/corte.jpg', description: 'URL de la foto del servicio', required: false })
    fotoUrl?: string | null;

    @ApiProperty({ example: 'ACTIVO', description: 'Estado del servicio (ACTIVO o INACTIVO)' })
    estado: string;

    @ApiProperty({ type: [BarberoEnServicioDto], description: 'Barberos que prestan este servicio' })
    barberos: BarberoEnServicioDto[];
}

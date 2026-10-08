import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EstadoServicio } from '../../../../../generated/prisma/enums';

/**
 * DTO para alternar el estado (activo/inactivo) de un servicio.
 * Se utiliza para operaciones de borrado lógico (soft delete).
 */
export class CambiarEstadoServicioDto {
    @ApiProperty({
        description: 'Nuevo estado para el servicio',
        enum: EstadoServicio,
        example: 'INACTIVO',
    })
    @IsEnum(EstadoServicio, {
        message: 'El estado debe ser ACTIVO o INACTIVO',
    })
    @IsNotEmpty({
        message: 'El estado es obligatorio',
    })
    estado: EstadoServicio;
}

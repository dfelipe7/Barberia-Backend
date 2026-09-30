import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { EstadoServicio } from '../../../../../generated/prisma/enums';

/**
 * DTO para la consulta filtrada de servicios del catálogo.
 * Permite buscar por coincidencia parcial en el nombre o descripción y filtrar por estado.
 */
export class FiltroServiciosDto {
    @ApiPropertyOptional({
        description: 'Buscar por nombre o descripción del servicio (búsqueda parcial)',
        example: 'Corte',
    })
    @IsOptional()
    @IsString()
    nombre?: string;

    @ApiPropertyOptional({
        description: 'Filtrar por estado del servicio',
        enum: EstadoServicio,
        example: EstadoServicio.ACTIVO,
    })
    @IsOptional()
    @IsEnum(EstadoServicio, { message: 'El estado debe ser ACTIVO o INACTIVO' })
    estado?: EstadoServicio;
}

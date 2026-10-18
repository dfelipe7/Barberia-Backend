import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { EstadoUsuario } from '../../../../../generated/prisma/enums';

/**
 * DTO para la consulta filtrada de barberos.
 * Permite buscar por coincidencia parcial de nombre/apellido y filtrar por estado.
 */
export class FiltroBarberosDto {
  @ApiPropertyOptional({
    description: 'Buscar por nombre o apellido del barbero (búsqueda parcial)',
    example: 'Carlos',
  })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por estado del rol de barbero',
    enum: EstadoUsuario,
    example: EstadoUsuario.ACTIVO,
  })
  @IsOptional()
  @IsEnum(EstadoUsuario, { message: 'El estado debe ser ACTIVO o INACTIVO' })
  estado?: EstadoUsuario;
}

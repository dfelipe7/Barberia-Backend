import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { EstadoUsuario } from '../../../../../generated/prisma/enums';

/**
 * DTO para la consulta filtrada de administradores.
 * Permite buscar por coincidencia parcial de nombre, apellido o email y filtrar por estado.
 */
export class FiltroAdministradoresDto {
  @ApiPropertyOptional({
    description: 'Buscar por nombre, apellido o correo del administrador',
    example: 'María',
  })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por estado del rol de administrador',
    enum: EstadoUsuario,
    example: EstadoUsuario.ACTIVO,
  })
  @IsOptional()
  @IsEnum(EstadoUsuario, { message: 'El estado debe ser ACTIVO o INACTIVO' })
  estado?: EstadoUsuario;
}

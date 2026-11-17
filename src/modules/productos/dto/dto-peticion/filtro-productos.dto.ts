import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EstadoProducto } from '../../../../../generated/prisma/enums';

/**
 * DTO para la consulta filtrada de productos del catálogo y gestión administrativa.
 * Permite buscar por coincidencia parcial en el nombre o descripción y filtrar por estado.
 */
export class FiltroProductosDto {
  @ApiPropertyOptional({
    description:
      'Buscar por nombre o descripción del producto (búsqueda parcial)',
    example: 'Cera',
  })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por estado del producto',
    enum: EstadoProducto,
    example: EstadoProducto.ACTIVO,
  })
  @IsOptional()
  @IsEnum(EstadoProducto, { message: 'El estado debe ser ACTIVO o INACTIVO' })
  estado?: EstadoProducto;

  /**
   * Declarado como opcional para absorber intentos de manipulación de tenant por query
   * sin provocar 400 en ValidationPipe; el aislamiento multitenant siempre se resuelve
   * desde el contexto (subdominio / X-Negocio-Slug), ignorando este campo.
   */
  @IsOptional()
  negocioId?: unknown;
}

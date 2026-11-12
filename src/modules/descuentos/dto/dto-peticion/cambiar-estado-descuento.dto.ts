import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

/**
 * Criterio HE-10-HU-04: activar o desactivar un descuento.
 *
 * El cliente indica explícitamente el estado objetivo (`activo: true` o `activo: false`),
 * evitando toggles ciegos y asegurando idempotencia ante reintentos.
 */
export class CambiarEstadoDescuentoDto {
  @ApiProperty({
    description:
      'Estado objetivo del descuento: true (activo) o false (inactivo)',
    example: true,
  })
  @IsBoolean({ message: 'El estado debe ser un valor booleano (true o false)' })
  @IsNotEmpty({ message: 'El estado es obligatorio' })
  activo: boolean;
}

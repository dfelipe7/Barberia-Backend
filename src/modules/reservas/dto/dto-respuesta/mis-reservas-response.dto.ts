import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReservaClienteDto } from './reserva-cliente.dto';

/**
 * Respuesta de HU-06 (`GET /reservas/me`): las reservas propias del cliente,
 * próximas primero. Cuando no tiene ninguna, `reservas` va vacío y `mensaje`
 * lleva el texto exacto del criterio de aceptación.
 */
export class MisReservasResponseDto {
  @ApiPropertyOptional({
    example: 'No tienes reservas registradas',
    description:
      'Presente únicamente cuando el cliente no tiene reservas registradas.',
  })
  mensaje?: string;

  @ApiProperty({ type: [ReservaClienteDto] })
  reservas: ReservaClienteDto[];
}

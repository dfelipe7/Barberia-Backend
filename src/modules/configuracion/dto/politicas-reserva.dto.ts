import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import {
  LIMITES_CITAS_DIARIAS,
  LIMITES_MINUTOS_OPERATIVOS,
} from '../configuracion.constants';

/**
 * Petición para actualizar las políticas operativas de reserva de la barbería.
 */
export class ActualizarPoliticasReservaDto {
  @ApiProperty({
    example: 120,
    description:
      'Minutos mínimos de antelación para que un cliente cancele su reserva en línea.',
    minimum: LIMITES_MINUTOS_OPERATIVOS.minimo,
    maximum: LIMITES_MINUTOS_OPERATIVOS.maximo,
  })
  @IsInt()
  @Min(LIMITES_MINUTOS_OPERATIVOS.minimo)
  @Max(LIMITES_MINUTOS_OPERATIVOS.maximo)
  reservaCancelacionAntelacionMinutos: number;

  @ApiProperty({
    example: 15,
    description:
      'Minutos de tolerancia tras la hora de inicio antes de marcar No-Show.',
    minimum: LIMITES_MINUTOS_OPERATIVOS.minimo,
    maximum: LIMITES_MINUTOS_OPERATIVOS.maximo,
  })
  @IsInt()
  @Min(LIMITES_MINUTOS_OPERATIVOS.minimo)
  @Max(LIMITES_MINUTOS_OPERATIVOS.maximo)
  reservaNoShowToleranciaMinutos: number;

  @ApiProperty({
    example: 3,
    description:
      'Número máximo de citas activas que un mismo cliente puede reservar para el mismo día.',
    minimum: LIMITES_CITAS_DIARIAS.minimo,
    maximum: LIMITES_CITAS_DIARIAS.maximo,
  })
  @IsInt()
  @Min(LIMITES_CITAS_DIARIAS.minimo)
  @Max(LIMITES_CITAS_DIARIAS.maximo)
  reservaMaxCitasDiariasCliente: number;
}

/**
 * Respuesta con las políticas operativas efectivas de reserva de la barbería.
 */
export class PoliticasReservaResponseDto {
  @ApiProperty({ example: 120 })
  reservaCancelacionAntelacionMinutos: number;

  @ApiProperty({ example: 15 })
  reservaNoShowToleranciaMinutos: number;

  @ApiProperty({ example: 3 })
  reservaMaxCitasDiariasCliente: number;
}

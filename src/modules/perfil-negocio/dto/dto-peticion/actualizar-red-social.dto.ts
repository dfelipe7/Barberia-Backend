import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Actualización parcial de UNA red social.
 *
 * No admite `tipo` ni `activo`: el tipo no se cambia (se borra y se crea) y
 * el estado se gestiona con DELETE y PATCH /activar.
 */
export class ActualizarRedSocialDto {
  @ApiPropertyOptional({ example: 'https://www.tiktok.com/@kyrios' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'La URL debe ser válida y usar HTTPS.' },
  )
  url?: string;

  @ApiPropertyOptional({
    example: 'Mi canal alternativo',
    description: 'Solo editable para tipo OTRO.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nombre?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;
}


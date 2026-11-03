import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TipoRedSocial } from '../../../../../generated/prisma/enums';

/**
 * Datos para registrar UNA red social en el perfil del negocio.
 *
 * Para redes predefinidas (TIKTOK, FACEBOOK, INSTAGRAM, WHATSAPP) el servicio
 * fija el campo `nombre` con el nombre canónico, por lo que enviarlo es
 * opcional. Para tipo OTRO el nombre es OBLIGATORIO y editable.
 */
export class CrearRedSocialDto {
  @ApiProperty({ enum: TipoRedSocial })
  @IsEnum(TipoRedSocial)
  tipo: TipoRedSocial;

  @ApiPropertyOptional({
    example: 'Mi blog personal',
    description: 'Requerido y editable solo para tipo OTRO.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nombre?: string;

  @ApiProperty({ example: 'https://www.instagram.com/kyrios' })
  @IsString()
  @MaxLength(500)
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'La URL debe ser válida y usar HTTPS.' },
  )
  url: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;
}

/**
 * Body del PUT /perfil-negocio/redes-sociales.
 *
 * Envuelve el array de redes para que el ValidationPipe pueda aplicar
 * decoradores de class-validator sobre cada elemento.
 */
export class ReemplazarRedesSocialesDto {
  @ApiProperty({ type: [CrearRedSocialDto] })
  redes: CrearRedSocialDto[];
}


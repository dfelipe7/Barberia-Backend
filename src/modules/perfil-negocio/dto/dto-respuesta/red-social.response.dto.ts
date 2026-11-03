import { ApiProperty } from '@nestjs/swagger';
import { TipoRedSocial } from '../../../../../generated/prisma/enums';

/**
 * Representación pública de una red social registrada en el perfil del negocio.
 */
export class RedSocialResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ enum: TipoRedSocial })
  tipo: TipoRedSocial;

  @ApiProperty({ example: 'Instagram' })
  nombre: string;

  @ApiProperty({ example: 'https://www.instagram.com/kyrios' })
  url: string;

  @ApiProperty({ example: 0 })
  orden: number;

  @ApiProperty({ example: true })
  activo: boolean;
}

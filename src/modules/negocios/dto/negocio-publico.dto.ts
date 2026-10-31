import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NegocioPublicoDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Kyrios Popayán Norte' })
  nombre: string;

  @ApiProperty({ example: 'kyrios-norte' })
  slug: string;

  @ApiPropertyOptional({ example: 'Popayán', nullable: true })
  ciudad: string | null;

  @ApiPropertyOptional({
    example: '/uploads/negocios/logo.png',
    nullable: true,
  })
  logoBlancoUrl: string | null;

  @ApiPropertyOptional({
    example: '/uploads/negocios/banner.png',
    nullable: true,
  })
  bannerUrl: string | null;

  @ApiPropertyOptional({ example: 'Tu estilo, tu momento', nullable: true })
  frasePrincipal: string | null;
}

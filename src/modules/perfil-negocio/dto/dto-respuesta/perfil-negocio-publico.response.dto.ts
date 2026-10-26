import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Identidad mínima del negocio que aparece en la respuesta del perfil.
 *
 * El nombre y el slug NO se duplican en `perfiles_negocio`: se leen de la
 * tabla `negocios` y se exponen aquí para que la web pueda mostrar la marca
 * sin una segunda petición.
 */
export class NegocioMarcaDto {
  @ApiProperty({
    example: 'KYRIOS STUDIO',
    description: 'Nombre público del negocio',
  })
  nombre: string;

  @ApiProperty({
    example: 'kyrios-studio',
    description: 'Slug público y estable del negocio',
  })
  slug: string;
}

/**
 * Respuesta PÚBLICA del perfil de marca y ubicación.
 *
 * Solo expone lo que la web necesita: identidad visual, contenido y
 * ubicación. NO incluye datos de gestión ni de auditoría.
 *
 * `configurado` indica si el negocio tiene ya un perfil guardado. Un negocio
 * sin perfil NO es un error: la respuesta es 200 con los campos a `null`, para
 * que la web pueda mostrar su propio contenido por defecto.
 */
export class PerfilNegocioPublicoResponseDto {
  @ApiProperty({
    type: NegocioMarcaDto,
    description: 'Negocio al que pertenece el perfil',
  })
  negocio: NegocioMarcaDto;

  @ApiProperty({
    example: false,
    description:
      'false si el negocio todavía no tiene un perfil guardado (campos a null)',
  })
  configurado: boolean;

  @ApiPropertyOptional({
    example: 'Barbería de alto estándar · Popayán',
    description: 'Frase principal de la marca',
    nullable: true,
  })
  frasePrincipal?: string | null;

  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/favicon.png',
    description:
      'Referencia al favicon (ruta o URL). No es un archivo binario.',
    nullable: true,
  })
  faviconUrl?: string | null;

  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/banner.png',
    description: 'Referencia al banner principal',
    nullable: true,
  })
  bannerUrl?: string | null;

  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/logo-blanco.png',
    description: 'Referencia al logo para fondos oscuros',
    nullable: true,
  })
  logoBlancoUrl?: string | null;

  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/logo-negro.png',
    description: 'Referencia al logo para fondos claros',
    nullable: true,
  })
  logoNegroUrl?: string | null;

  @ApiPropertyOptional({
    example: 'Vía al Bosque, Tv 9A Norte',
    description: 'Dirección de la barbería',
    nullable: true,
  })
  direccion?: string | null;

  @ApiPropertyOptional({
    example: 'Popayán',
    description: 'Ciudad de la barbería',
    nullable: true,
  })
  ciudad?: string | null;

  @ApiPropertyOptional({
    example: 'Cauca',
    description: 'Departamento de la barbería',
    nullable: true,
  })
  departamento?: string | null;

  @ApiPropertyOptional({
    example: 'Local 2, junto a la panadería',
    description: 'Referencia opcional para orientarse',
    nullable: true,
  })
  referencia?: string | null;

  @ApiPropertyOptional({
    example: 2.4839891,
    description: 'Latitud en grados decimales',
    nullable: true,
  })
  latitud?: number | null;

  @ApiPropertyOptional({
    example: -76.5807622,
    description: 'Longitud en grados decimales',
    nullable: true,
  })
  longitud?: number | null;

  @ApiPropertyOptional({
    example:
      'https://www.google.com/maps/search/?api=1&query=2.4839891,-76.5807622',
    description:
      'URL canónica del mapa, DERIVADA de las coordenadas. Es null si el negocio no tiene coordenadas. No requiere API key.',
    nullable: true,
  })
  mapsUrl?: string | null;
}

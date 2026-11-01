import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NegocioMarcaDto } from './perfil-negocio-publico.response.dto';

/**
 * Bloque de contenido de la marca.
 */
export class ContenidoMarcaDto {
  @ApiPropertyOptional({
    example: 'Barbería de alto estándar · Popayán',
    description: 'Frase principal de la marca',
    nullable: true,
  })
  frasePrincipal: string | null;

  @ApiPropertyOptional({
    example: 'clasico-azul',
    description: 'Identificador del tema visual / paleta de marca',
    nullable: true,
  })
  temaKey: string | null;
}

/**
 * Bloque de ubicación del negocio.
 *
 * `latitud` y `longitud` van siempre juntas o a la vez nulas.
 */
export class UbicacionNegocioDto {
  @ApiPropertyOptional({
    example: 'Vía al Bosque, Tv 9A Norte',
    description: 'Dirección de la barbería',
    nullable: true,
  })
  direccion: string | null;

  @ApiPropertyOptional({
    example: 'Popayán',
    description: 'Ciudad de la barbería',
    nullable: true,
  })
  ciudad: string | null;

  @ApiPropertyOptional({
    example: 'Cauca',
    description: 'Departamento de la barbería',
    nullable: true,
  })
  departamento: string | null;

  @ApiPropertyOptional({
    example: 'Local 2, junto a la panadería',
    description: 'Referencia opcional para orientarse',
    nullable: true,
  })
  referencia: string | null;

  @ApiPropertyOptional({
    example: 2.4839891,
    description: 'Latitud en grados decimales',
    nullable: true,
  })
  latitud: number | null;

  @ApiPropertyOptional({
    example: -76.5807622,
    description: 'Longitud en grados decimales',
    nullable: true,
  })
  longitud: number | null;

  @ApiPropertyOptional({
    example:
      'https://www.google.com/maps/search/?api=1&query=2.4839891,-76.5807622',
    description:
      'URL canónica del mapa, DERIVADA de las coordenadas. Es null si no hay coordenadas. No requiere API key.',
    nullable: true,
  })
  mapsUrl: string | null;
}

/**
 * Bloque de REFERENCIAS A ARCHIVOS de la identidad visual.
 *
 * En esta fase solo se guardan referencias (rutas o URLs). La carga física de
 * archivos es una fase posterior.
 */
export class ReferenciasArchivoDto {
  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/favicon.png',
    description: 'Referencia al favicon',
    nullable: true,
  })
  faviconUrl: string | null;

  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/banner.png',
    description: 'Referencia al banner principal',
    nullable: true,
  })
  bannerUrl: string | null;

  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/logo-blanco.png',
    description: 'Referencia al logo para fondos oscuros',
    nullable: true,
  })
  logoBlancoUrl: string | null;

  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/logo-negro.png',
    description: 'Referencia al logo para fondos claros',
    nullable: true,
  })
  logoNegroUrl: string | null;
}

/**
 * Respuesta ADMINISTRATIVA del perfil de marca y ubicación.
 *
 * Se diferencia de la vista PÚBLICA en dos cosas:
 *  1. Agrupa el contenido por los bloques que gestiona la API (contenido y
 *     ubicación, por un lado; referencias de archivo, por otro).
 *  2. Añade la AUDITORÍA (`creadoEn`, `actualizadoEn`) y el indicador de si
 *     el perfil está configurado.
 *
 * Solo la pueden leer SUPERADMIN y ADMINISTRADOR del negocio del contexto.
 */
export class PerfilNegocioGestionResponseDto {
  @ApiProperty({
    type: NegocioMarcaDto,
    description: 'Negocio al que pertenece el perfil',
  })
  negocio: NegocioMarcaDto;

  @ApiProperty({
    example: false,
    description:
      'false si el negocio todavía no tiene un perfil guardado (bloques a null)',
  })
  configurado: boolean;

  @ApiProperty({
    type: ContenidoMarcaDto,
    description: 'Contenido de la marca',
  })
  contenido: ContenidoMarcaDto;

  @ApiProperty({
    type: UbicacionNegocioDto,
    description: 'Ubicación del negocio',
  })
  ubicacion: UbicacionNegocioDto;

  @ApiProperty({
    type: ReferenciasArchivoDto,
    description:
      'Referencias a los archivos de la identidad visual (rutas o URLs, nunca binarios)',
  })
  referenciasArchivo: ReferenciasArchivoDto;

  @ApiProperty({
    example: '2026-10-24T12:00:00.000Z',
    description: 'Momento de creación del perfil',
  })
  creadoEn: Date;

  @ApiProperty({
    example: '2026-10-24T12:00:00.000Z',
    description: 'Momento de la última actualización del perfil',
  })
  actualizadoEn: Date;
}

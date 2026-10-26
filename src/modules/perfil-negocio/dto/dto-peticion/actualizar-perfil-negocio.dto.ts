import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
} from 'class-validator';
import { CoordenadasJuntasConstraint } from '../../../../common/validators/coordenadas-juntas.validator';
import {
  LATITUD_MAXIMA,
  LATITUD_MINIMA,
  LIMITE_CIUDAD,
  LIMITE_DEPARTAMENTO,
  LIMITE_DIRECCION,
  LIMITE_FRASE_PRINCIPAL,
  LIMITE_REFERENCIA,
  LIMITE_URL_ARCHIVO,
  LONGITUD_MAXIMA,
  LONGITUD_MINIMA,
  REGEX_REFERENCIA_ARCHIVO,
} from '../../perfil-negocio.constants';

/**
 * Actualización del CONTENIDO y de la UBICACIÓN del perfil del negocio.
 *
 * Semántica de `PUT`: REEMPLAZA el bloque completo. Un campo omitido se
 * guarda como `null` (se limpia). Así el comportamiento es inequívoco y no
 * depende de un estado previo.
 *
 * NO se acepta ningún identificador de negocio: el negocio es SIEMPRE el del
 * contexto de la petición (subdominio o `X-Negocio-Slug`), validado por el
 * servidor. El `ValidationPipe` global rechaza además cualquier campo
 * desconocido (`forbidNonWhitelisted`).
 */
export class ActualizarPerfilNegocioDto {
  @ApiPropertyOptional({
    example: 'Barbería de alto estándar · Popayán',
    description: 'Frase principal de la marca (lema o descriptor corto)',
    maxLength: LIMITE_FRASE_PRINCIPAL,
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_FRASE_PRINCIPAL)
  frasePrincipal?: string;

  @ApiPropertyOptional({
    example: 'Vía al Bosque, Tv 9A Norte',
    description: 'Dirección de la barbería',
    maxLength: LIMITE_DIRECCION,
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_DIRECCION)
  direccion?: string;

  @ApiPropertyOptional({
    example: 'Popayán',
    description: 'Ciudad de la barbería',
    maxLength: LIMITE_CIUDAD,
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_CIUDAD)
  ciudad?: string;

  @ApiPropertyOptional({
    example: 'Cauca',
    description: 'Departamento de la barbería',
    maxLength: LIMITE_DEPARTAMENTO,
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_DEPARTAMENTO)
  departamento?: string;

  @ApiPropertyOptional({
    example: 'Local 2, junto a la panadería',
    description: 'Referencia opcional para orientarse',
    maxLength: LIMITE_REFERENCIA,
  })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_REFERENCIA)
  referencia?: string;

  @ApiPropertyOptional({
    example: 2.4839891,
    description:
      'Latitud en grados decimales. Debe informarse JUNTO con la longitud.',
    minimum: LATITUD_MINIMA,
    maximum: LATITUD_MAXIMA,
  })
  @IsOptional()
  @Validate(CoordenadasJuntasConstraint)
  @IsNumber()
  @Min(LATITUD_MINIMA)
  @Max(LATITUD_MAXIMA)
  latitud?: number;

  @ApiPropertyOptional({
    example: -76.5807622,
    description:
      'Longitud en grados decimales. Debe informarse JUNTO con la latitud.',
    minimum: LONGITUD_MINIMA,
    maximum: LONGITUD_MAXIMA,
  })
  @IsOptional()
  @Validate(CoordenadasJuntasConstraint)
  @IsNumber()
  @Min(LONGITUD_MINIMA)
  @Max(LONGITUD_MAXIMA)
  longitud?: number;
}

/**
 * Actualización de las REFERENCIAS A ARCHIVOS de la identidad visual.
 *
 * En esta fase NO se suben archivos: solo se guardan las referencias (rutas o
 * URLs) que devolverá la carga física cuando se implemente. La carga física
 * de imágenes es una fase posterior.
 *
 * Semántica de `PUT`: REEMPLAZA el bloque completo de referencias.
 */
export class ActualizarReferenciasPerfilDto {
  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/favicon.png',
    description:
      'Referencia al favicon. Ruta relativa servida por la aplicación o URL http/https.',
    maxLength: LIMITE_URL_ARCHIVO,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(REGEX_REFERENCIA_ARCHIVO, {
    message:
      'La referencia debe ser una ruta relativa (/...) o una URL http/https.',
  })
  faviconUrl?: string;

  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/banner.png',
    description: 'Referencia al banner principal',
    maxLength: LIMITE_URL_ARCHIVO,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(REGEX_REFERENCIA_ARCHIVO, {
    message:
      'La referencia debe ser una ruta relativa (/...) o una URL http/https.',
  })
  bannerUrl?: string;

  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/logo-blanco.png',
    description: 'Referencia al logo para fondos oscuros',
    maxLength: LIMITE_URL_ARCHIVO,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(REGEX_REFERENCIA_ARCHIVO, {
    message:
      'La referencia debe ser una ruta relativa (/...) o una URL http/https.',
  })
  logoBlancoUrl?: string;

  @ApiPropertyOptional({
    example: '/uploads/negocios/kyrios-studio/logo-negro.png',
    description: 'Referencia al logo para fondos claros',
    maxLength: LIMITE_URL_ARCHIVO,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(REGEX_REFERENCIA_ARCHIVO, {
    message:
      'La referencia debe ser una ruta relativa (/...) o una URL http/https.',
  })
  logoNegroUrl?: string;
}

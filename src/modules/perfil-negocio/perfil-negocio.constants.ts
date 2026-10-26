/**
 * Constantes del perfil de marca y ubicación de un negocio (Fase 14).
 *
 * Los límites de longitud coinciden con los tipos de columna del esquema
 * (`prisma/schema.prisma`, modelo `PerfilNegocio`): el DTO no puede admitir
 * un valor que la base de datos vaya a truncar o a rechazar.
 */

/** Longitud máxima de la frase principal de la marca. */
export const LIMITE_FRASE_PRINCIPAL = 200;

/** Longitud máxima de la dirección. */
export const LIMITE_DIRECCION = 200;

/** Longitud máxima de la ciudad. */
export const LIMITE_CIUDAD = 120;

/** Longitud máxima del departamento. */
export const LIMITE_DEPARTAMENTO = 120;

/** Longitud máxima de la referencia de ubicación. */
export const LIMITE_REFERENCIA = 200;

/** Longitud máxima de una referencia a archivo (ruta o URL). */
export const LIMITE_URL_ARCHIVO = 500;

/**
 * Formato admitido para una referencia a archivo.
 *
 * Solo se aceptan RUTAS RELATIVAS (las que sirve la propia aplicación, como
 * `/uploads/negocios/kyrios/logo.png`) o URLS `http`/`https`. Se rechazan
 * explícitamente los esquemas ejecutables (`javascript:`, `data:`): una
 * referencia de imagen no es un vector de ejecución.
 */
export const REGEX_REFERENCIA_ARCHIVO = /^(?:\/|https?:\/\/)/i;

/** Latitud mínima admitida (grados). */
export const LATITUD_MINIMA = -90;

/** Latitud máxima admitida (grados). */
export const LATITUD_MAXIMA = 90;

/** Longitud mínima admitida (grados). */
export const LONGITUD_MINIMA = -180;

/** Longitud máxima admitida (grados). */
export const LONGITUD_MAXIMA = 180;

/**
 * Plantilla de la URL canónica de Google Maps.
 *
 * Es la misma forma que usa ya el frontend (`?api=1&query=...`), pero con las
 * COORDENADAS como consulta: al derivarse de `latitud`/`longitud`, no puede
 * quedar desincronizada de la ubicación real.
 *
 * No requiere API key ni facturación: es un enlace de búsqueda, no la
 * Google Maps Embed API.
 */
export const PLANTILLA_URL_MAPA =
  'https://www.google.com/maps/search/?api=1&query=';

/**
 * Recursos de marca que puede gestionar un negocio (Fase 15).
 *
 * Son los CUATRO recursos del perfil. Cada uno tiene su propio campo en
 * `PerfilNegocio`, su tipo de archivo admitido y su límite de tamaño.
 */
export const RECURSOS_PERFIL = {
  FAVICON: 'favicon',
  BANNER: 'banner',
  LOGO_BLANCO: 'logo-blanco',
  LOGO_NEGRO: 'logo-negro',
} as const;

export type RecursoPerfil =
  (typeof RECURSOS_PERFIL)[keyof typeof RECURSOS_PERFIL];

/** Campo de `PerfilNegocio` donde se guarda la referencia del recurso. */
export type CampoReferenciaPerfil =
  'faviconUrl' | 'bannerUrl' | 'logoBlancoUrl' | 'logoNegroUrl';

/** Definición de un recurso de marca. */
export interface DefinicionRecursoPerfil {
  /** Identificador del recurso (estable en la API). */
  recurso: RecursoPerfil;
  /** Campo del perfil que almacena su referencia. */
  campo: CampoReferenciaPerfil;
  /** Formato admitido (detectado por el CONTENIDO del archivo). */
  formato: 'svg' | 'png';
  /** Extensión del archivo almacenado. */
  extension: string;
  /** Tipo MIME con el que se sirve. */
  mime: string;
  /** Tamaño máximo admitido, en bytes. */
  limiteBytes: number;
  /** Nombre legible para los mensajes de error. */
  etiqueta: string;
}

/** Límite de tamaño de un SVG de marca (favicon o logo). */
export const LIMITE_BYTES_SVG = 256 * 1024;

/** Límite de tamaño del banner PNG. */
export const LIMITE_BYTES_PNG = 2 * 1024 * 1024;

/**
 * Los cuatro recursos de marca y sus reglas.
 *
 * El SVG se limita más que el PNG porque es un documento de texto: un logo
 * razonable ocupa unos pocos kilobytes y un SVG enorme solo puede ser un
 * intento de agotar el disco.
 */
export const RECURSOS: readonly DefinicionRecursoPerfil[] = [
  {
    recurso: RECURSOS_PERFIL.FAVICON,
    campo: 'faviconUrl',
    formato: 'svg',
    extension: 'svg',
    mime: 'image/svg+xml',
    limiteBytes: LIMITE_BYTES_SVG,
    etiqueta: 'favicon',
  },
  {
    recurso: RECURSOS_PERFIL.BANNER,
    campo: 'bannerUrl',
    formato: 'png',
    extension: 'png',
    mime: 'image/png',
    limiteBytes: LIMITE_BYTES_PNG,
    etiqueta: 'banner',
  },
  {
    recurso: RECURSOS_PERFIL.LOGO_BLANCO,
    campo: 'logoBlancoUrl',
    formato: 'svg',
    extension: 'svg',
    mime: 'image/svg+xml',
    limiteBytes: LIMITE_BYTES_SVG,
    etiqueta: 'logo blanco',
  },
  {
    recurso: RECURSOS_PERFIL.LOGO_NEGRO,
    campo: 'logoNegroUrl',
    formato: 'svg',
    extension: 'svg',
    mime: 'image/svg+xml',
    limiteBytes: LIMITE_BYTES_SVG,
    etiqueta: 'logo negro',
  },
];

/** Definición de un recurso por su identificador. */
export function definicionRecurso(
  recurso: RecursoPerfil,
): DefinicionRecursoPerfil {
  const definicion = RECURSOS.find((item) => item.recurso === recurso);

  if (!definicion) {
    throw new Error(`Recurso de perfil desconocido: '${recurso}'`);
  }

  return definicion;
}

/**
 * Deriva la URL canónica del mapa a partir de las coordenadas.
 *
 * @returns La URL, o `null` si no hay coordenadas (en ese caso no hay
 *  location enlazable y la respuesta expone `null`).
 */
export function derivarUrlMapa(
  latitud: number | null,
  longitud: number | null,
): string | null {
  if (latitud === null || longitud === null) {
    return null;
  }

  return `${PLANTILLA_URL_MAPA}${latitud},${longitud}`;
}

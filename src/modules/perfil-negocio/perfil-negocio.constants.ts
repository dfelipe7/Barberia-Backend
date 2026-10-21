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

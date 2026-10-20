/**
 * Claves de las configuraciones funcionales almacenadas en base de datos.
 *
 * SEPARACIÓN DE ÁMBITOS
 * ---------------------
 * - `ConfiguracionSistema` (`configuraciones_sistema`): parámetros GLOBALES de
 *   plataforma (límites generales, características de despliegue, políticas que
 *   no pertenecen a una barbería concreta).
 * - `ConfiguracionNegocio` (`configuraciones_negocio`): políticas OPERATIVAS
 *   de cada negocio (antelación de cancelación, tolerancia de NO_SHOW, ...).
 *
 * Las claves operativas se mantienen con el MISMO nombre que usaba la
 * aplicación cuando eran globales, para que la resolución del valor efectivo
 * (negocio -> global -> valor por defecto) no requiera renombrar nada.
 */
export const CLAVES_CONFIGURACION = {
  RESERVA_CANCELACION_ANTELACION_MINUTOS:
    'reserva_cancelacion_antelacion_minutos',
  RESERVA_NO_SHOW_TOLERANCIA_MINUTOS: 'reserva_no_show_tolerancia_minutos',
} as const;

export type ClaveConfiguracion =
  (typeof CLAVES_CONFIGURACION)[keyof typeof CLAVES_CONFIGURACION];

/**
 * Valores por defecto de las políticas operativas, en MINUTOS.
 *
 * Son la última línea de la resolución del valor efectivo: si el negocio no
 * tiene la clave, no existe un valor global válido y el valor almacenado es
 * inválido, se aplica este valor. Son los MISMOS valores que el proyecto
 * usaba antes de la segmentación por negocio (120 y 15 minutos).
 */
export const VALORES_POR_DEFECTO_OPERATIVOS = {
  RESERVA_CANCELACION_ANTELACION_MINUTOS: 120,
  RESERVA_NO_SHOW_TOLERANCIA_MINUTOS: 15,
} as const;

/**
 * Configuraciones operativas (ámbito de negocio) con su valor inicial.
 *
 * Es la lista que la inicialización de un negocio crea si la clave todavía no
 * existe. `valorPorDefecto` es el valor SEMILLA: en una segunda ejecución no
 * se sobrescribe, porque una clave ya presente puede estar personalizada por
 * un administrador.
 */
export const CLAVES_CONFIGURACION_OPERATIVA: ReadonlyArray<{
  clave: string;
  valorPorDefecto: string;
  descripcion: string;
}> = [
  {
    clave: CLAVES_CONFIGURACION.RESERVA_CANCELACION_ANTELACION_MINUTOS,
    valorPorDefecto: String(
      VALORES_POR_DEFECTO_OPERATIVOS.RESERVA_CANCELACION_ANTELACION_MINUTOS,
    ),
    descripcion:
      'Minutos mínimos de antelación para que un cliente cancele su reserva en línea.',
  },
  {
    clave: CLAVES_CONFIGURACION.RESERVA_NO_SHOW_TOLERANCIA_MINUTOS,
    valorPorDefecto: String(
      VALORES_POR_DEFECTO_OPERATIVOS.RESERVA_NO_SHOW_TOLERANCIA_MINUTOS,
    ),
    descripcion:
      'Minutos de tolerancia tras la hora de inicio antes de poder marcar una reserva como NO_SHOW.',
  },
];

/**
 * Límites razonables de una política expresada en MINUTOS.
 *
 * `minimo: 1` evita una política inerte (cero minutos de antelación o de
 * tolerancia). `maximo: 10080` (siete días) evita valores absurdos que dejarían
 * el sistema sin poder cancelar ni marcar reservas. `entero` trunca el valor
 * a minutos enteros, que es la unidad de la política.
 *
 * Un valor fuera de estos límites NO se aplica: se trata como inválido y la
 * resolución continúa con el siguiente candidato (global o valor por defecto).
 */
export const LIMITES_MINUTOS_OPERATIVOS = {
  minimo: 1,
  maximo: 10_080,
  entero: true,
} as const;

/**
 * Claves que admiten el FALLBACK GLOBAL (compatibilidad temporal).
 *
 * POLÍTICA EXPLÍCITA
 * ------------------
 * Durante la transición, una política operativa que el negocio todavía no
 * tiene puede heredar el valor global de plataforma (el valor que se usaba
 * antes de segmentar). Es una compatibilidad TEMPORAL y ACOTADA:
 *
 * - Solo afecta a las claves enumeradas aquí. Cualquier otra clave ausente en
 *   el negocio va DIRECTO al valor por defecto: un parámetro global de
 *   plataforma no se convierte sin querer en una política de negocio.
 * - El valor global se cachea en su propio ámbito (`global:`), nunca en el
 *   del negocio: un negocio no "posee" un valor heredado.
 * - Cuando la Fase 8 (o la de endurecimiento de configuración) lo decida, esta
 *   lista se vacía y el comportamiento pasa a ser estrictamente negocio -> valor
 *   por defecto.
 */
export const CLAVES_CON_FALLBACK_GLOBAL: ReadonlySet<string> = new Set([
  CLAVES_CONFIGURACION.RESERVA_CANCELACION_ANTELACION_MINUTOS,
  CLAVES_CONFIGURACION.RESERVA_NO_SHOW_TOLERANCIA_MINUTOS,
]);

/**
 * Tipos soportados por una configuración funcional. Refleja el enum Prisma
 * `TipoConfiguracion` y define cómo validar/parsear `valor` al leerlo.
 */
export const TipoConfiguracion = {
  TEXTO: 'TEXTO',
  NUMERO: 'NUMERO',
  BOOLEANO: 'BOOLEANO',
  JSON: 'JSON',
} as const;

export type TipoConfiguracion =
  (typeof TipoConfiguracion)[keyof typeof TipoConfiguracion];

/**
 * Milisegundos que una configuración permanece en caché antes de volver a
 * consultarse. La caché es de vida corta para que los cambios en base de datos
 * no queden obsoletos indefinidamente sin necesidad de reiniciar la aplicación.
 */
export const TTL_CACHE_CONFIGURACION_MS = 60_000;

/**
 * Prefijos de las claves de caché.
 *
 * La caché está SEGMENTADA por ámbito: la entrada de una clave en un negocio
 * nunca se confunde con la de otro negocio ni con el valor global de
 * plataforma. `negocio:1:clave` y `global:clave` son claves distintas.
 */
export const PREFIJO_CACHE = {
  NEGOCIO: 'negocio',
  GLOBAL: 'global',
} as const;

/** Clave de caché de una configuración en el ámbito de un negocio. */
export function claveCacheNegocio(negocioId: number, clave: string): string {
  return `${PREFIJO_CACHE.NEGOCIO}:${negocioId}:${clave}`;
}

/** Clave de caché de una configuración en el ámbito global de plataforma. */
export function claveCacheGlobal(clave: string): string {
  return `${PREFIJO_CACHE.GLOBAL}:${clave}`;
}

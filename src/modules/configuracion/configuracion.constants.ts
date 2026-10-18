/**
 * Claves de las configuraciones funcionales almacenadas en la tabla
 * `configuraciones_sistema`. Se declaran una sola vez para evitar literales
 * duplicados entre el seed, los repositorios y los servicios consumidores.
 */
export const CLAVES_CONFIGURACION = {
  RESERVA_CANCELACION_ANTELACION_MINUTOS:
    'reserva_cancelacion_antelacion_minutos',
  RESERVA_NO_SHOW_TOLERANCIA_MINUTOS: 'reserva_no_show_tolerancia_minutos',
} as const;

export type ClaveConfiguracion =
  (typeof CLAVES_CONFIGURACION)[keyof typeof CLAVES_CONFIGURACION];

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

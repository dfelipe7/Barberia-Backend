/**
 * Constantes de la migración de datos al modelo multitenant (Fase 2).
 *
 * Fuente única compartida por el script de migración (`prisma/multitenant/`)
 * y sus pruebas, para que la lista de modelos, las claves de configuración y
 * las variables de entorno no se dupliquen.
 */

/**
 * Modelos que pasan a pertenecer a un negocio, con su nombre FÍSICO de tabla.
 *
 * Los nombres físicos se toman del esquema Prisma: `reservations`,
 * `barber_weekly_slots`, `barber_schedule_blocks` y `general_closures` están
 * mapeados con `@@map`; el resto usa el nombre del modelo. Un nombre de tabla
 * equivocado en el backfill produciría un error en tiempo de ejecución (o, peor,
 * actualizaría la tabla equivocada), por eso la lista es cerrada y central.
 */
export const MODELOS_CON_NEGOCIO: ReadonlyArray<{
  /** Nombre del modelo en Prisma (clave del delegate). */
  modelo: string;
  /** Nombre físico de la tabla. */
  tabla: string;
  /** Etiqueta legible para los informes. */
  etiqueta: string;
}> = [
  {
    modelo: 'administrador',
    tabla: 'Administrador',
    etiqueta: 'Administrador',
  },
  { modelo: 'barbero', tabla: 'Barbero', etiqueta: 'Barbero' },
  { modelo: 'cliente', tabla: 'Cliente', etiqueta: 'Cliente' },
  { modelo: 'servicio', tabla: 'Servicio', etiqueta: 'Servicio' },
  {
    modelo: 'barberoServicio',
    tabla: 'BarberoServicio',
    etiqueta: 'BarberoServicio',
  },
  {
    modelo: 'reservation',
    tabla: 'reservations',
    etiqueta: 'Reservation',
  },
  {
    modelo: 'barberWeeklySlot',
    tabla: 'barber_weekly_slots',
    etiqueta: 'BarberWeeklySlot',
  },
  {
    modelo: 'barberScheduleBlock',
    tabla: 'barber_schedule_blocks',
    etiqueta: 'BarberScheduleBlock',
  },
  {
    modelo: 'generalClosure',
    tabla: 'general_closures',
    etiqueta: 'GeneralClosure',
  },
];

/**
 * Configuraciones operativas que se copian al ámbito del negocio.
 *
 * La lista vive en el módulo de configuración (única fuente de las claves y de
 * los valores por defecto) y se re-exporta aquí para que el script de
 * migración de la Fase 2 siga usando el mismo contrato.
 */
export { CLAVES_CONFIGURACION_OPERATIVA } from '../../configuracion/configuracion.constants';

/** Variable de entorno con el nombre público del primer negocio. */
export const NEGOCIO_INICIAL_NOMBRE_ENV = 'NEGOCIO_INICIAL_NOMBRE';

/** Variable de entorno con el slug público y estable del primer negocio. */
export const NEGOCIO_INICIAL_SLUG_ENV = 'NEGOCIO_INICIAL_SLUG';

/** Variable de entorno con el tamaño de lote del backfill. */
export const NEGOCIO_BACKFILL_LOTE_ENV = 'NEGOCIO_BACKFILL_LOTE';

/** Longitud máxima del slug, alineada con la columna `negocios.slug`. */
export const LONGITUD_MAXIMA_SLUG = 63;

/**
 * Formato admitido del slug: exclusivamente `a-z`, `0-9` y guiones, sin
 * empezar ni terminar en guion (compatibilidad con una etiqueta DNS, que es el
 * uso previsto como subdominio).
 */
export const REGEX_SLUG_NEGOCIO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

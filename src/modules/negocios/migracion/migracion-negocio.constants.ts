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
 * Se mantienen los MISMOS nombres de clave que ya usa la aplicación, para que
 * la resolución del valor efectivo (negocio -> global -> valor por defecto) no
 * requiera renombrar nada. Los valores por defecto son los que ya define el
 * seed (120 y 15 minutos).
 */
export const CLAVES_CONFIGURACION_OPERATIVA: ReadonlyArray<{
  clave: string;
  valorPorDefecto: string;
  descripcion: string;
}> = [
  {
    clave: 'reserva_cancelacion_antelacion_minutos',
    valorPorDefecto: '120',
    descripcion:
      'Minutos mínimos de antelación para que un cliente cancele su reserva en línea.',
  },
  {
    clave: 'reserva_no_show_tolerancia_minutos',
    valorPorDefecto: '15',
    descripcion:
      'Minutos de tolerancia tras la hora de inicio antes de poder marcar una reserva como NO_SHOW.',
  },
];

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

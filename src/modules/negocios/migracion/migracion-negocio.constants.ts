/**
 * Constantes de la migración de datos al modelo multitenant (Fase 2).
 *
 * Se declaran una sola vez para que el servicio, el CLI y las pruebas
 * compartan exactamente los mismos nombres de tabla, claves y variables de
 * entorno.
 */

/**
 * Modelos que pasan a pertenecer a un negocio, con su nombre FÍSICO de tabla.
 *
 * Los nombres físicos se toman del esquema Prisma: `reservations`,
 * `barber_weekly_slots`, `barber_schedule_blocks` y `general_closures` están
 * mapeados con `@@map`; el resto usa el nombre del modelo. Un nombre de tabla
 * equivocado en el SQL del backfill o de la verificación produciría un error
 * en tiempo de ejecución, por eso se centralizan aquí.
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
  { modelo: 'reservation', tabla: 'reservations', etiqueta: 'Reservation' },
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

/** Longitud máxima del `slug`, alineada con la columna `negocios.slug`. */
export const LONGITUD_MAXIMA_SLUG = 63;

/**
 * Formato admitido del `slug`: exclusivamente `a-z`, `0-9` y guiones, sin
 * empezar ni terminar en guion (compatibilidad con una etiqueta DNS, que es
 * el uso previsto como subdominio).
 */
export const REGEX_SLUG_NEGOCIO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Variables de entorno que precisa la migración. */
export const VARIABLES_MIGRACION = {
  NOMBRE: 'NEGOCIO_INICIAL_NOMBRE',
  SLUG: 'NEGOCIO_INICIAL_SLUG',
  ZONA_HORARIA: 'NEGOCIO_INICIAL_ZONA_HORARIA',
  LOTE: 'NEGOCIO_BACKFILL_LOTE',
} as const;

/** Zona horaria por defecto: la que usa hoy la lógica de fechas del proyecto. */
export const ZONA_HORARIA_POR_DEFECTO = 'America/Bogota';

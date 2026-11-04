/**
 * DATOS DE DESARROLLO LOCAL MULTITENANT (Fase 13).
 *
 * Esto NO son datos de producción: son el escenario de prueba inicial de las
 * dos barberías del entorno LOCAL (`bd_barberia_multitenant_dev`).
 *
 * PRINCIPIOS
 * ----------
 * - Los datos viven AQUÍ, en un único sitio, para que sean configurables y
 *   auditables de un vistazo. El seed NO los tiene escritos dentro.
 * - Las identidades de las personas reales se referencian por su CORREO
 *   CANÓNICO (los mismos que ya usa el código del proyecto). No se inventan
 *   identidades de Google, ni contraseñas, ni correos de personas reales.
 * - Los barberos de prueba son cuentas EXCLUSIVAS de desarrollo, con dominio
 *   reservado `.invalid` (RFC 2606): nunca son deliverables ni pueden
 *   confundirse con una identidad real.
 * - Los precios y las duraciones son FICTICIOS y de desarrollo.
 */

/** Base de datos EXCLUSIVA de este seed. Cualquier otra se rechaza. */
export const BASE_DATOS_PERMITIDA = 'bd_barberia_multitenant_dev';

/** Bases de datos que NUNCA son destino de este seed. */
export const BASES_DATOS_PROHIBIDAS: readonly string[] = ['bd_barberia'];

/**
 * Hosts admitidos: solo el entorno LOCAL.
 *
 * - `localhost` / `127.0.0.1` / `::1`: el MySQL del contenedor, por el puerto
 *   publicado en el host.
 * - `mysql-multitenant-dev`: el nombre del servicio dentro de la red de Docker
 *   Compose del entorno multitenant.
 *
 * Cualquier otro host (Railway included) se RECHAZA.
 */
export const HOSTS_LOCALES_PERMITIDOS: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '::1',
  'mysql-multitenant-dev',
];

/**
 * Patrón de host de Railway (prohibido).
 *
 * Los hosts de Railway son del tipo `xxx.up.railway.app` y pueden llevar
 * subdominios de producción. Se rechazan por patrón, no por lista.
 */
export const REGEX_HOST_RAILWAY = /(^|\.)railway\.app$/i;

/** Variable de entorno que autoriza explícitamente la ejecución del seed. */
export const ENV_AUTORIZACION_SEED = 'SEED_LOCAL_MULTITENANT';

/** Valor exigido en `SEED_LOCAL_MULTITENANT` para autorizar la ejecución. */
export const VALOR_AUTORIZACION_SEED = '1';

/**
 * Dominio de los correos de las cuentas de barbero de prueba.
 *
 * `.invalid` es un TLD reservado (RFC 2606) que nunca se resuelve: estas
 * cuentas no son identidades reales. Se puede cambiar por variable de
 * entorno para usar otro dominio de pruebas.
 */
export const ENV_DOMINIO_CORREO_PRUEBA = 'SEED_LOCAL_DOMINIO_CORREO';

/** Dominio por defecto de las cuentas de prueba. */
export const DOMINIO_CORREO_PRUEBA_POR_DEFECTO = 'local.invalid';

/**
 * Migración que debe estar aplicada: es la que añade
 * `Administrador.superadmin`, la columna donde vive el carácter SUPERADMIN de
 * una membresía. Si no está aplicada, el seed no puede garantizar el modelo
 * de privilegios y NO debe escribir nada.
 */
export const MIGRACION_SUPERADMIN_POR_NEGOCIO =
  '20261022120000_superadmin_por_negocio';

/** Persona real identificada por su correo canónico. */
export interface PersonaLocalSpec {
  /** Correo canónico (idéntico al que usa el código del proyecto). */
  email: string;
  /** Nombre visible tal y como figura en el código del proyecto. */
  nombre: string;
  /** Apellido visible tal y como figura en el código del proyecto. */
  apellido: string;
}

/** Barbería de prueba con su reparto de superadministradores y barberos. */
export interface NegocioLocalSpec {
  /** Nombre público. */
  nombre: string;
  /** Slug público y estable. */
  slug: string;
  /** Superadministradores (membresías con `superadmin = true`). */
  superadmins: readonly PersonaLocalSpec[];
  /** Barberos de prueba. */
  barberos: readonly BarberoLocalSpec[];
}

/** Barbero de prueba (persona ficticia y exclusivamente de desarrollo). */
export interface BarberoLocalSpec {
  /** Clave interna dentro del negocio (parte del correo de prueba). */
  clave: string;
  /** Nombre visible de la cuenta de prueba. */
  nombre: string;
  /** Apellido visible de la cuenta de prueba. */
  apellido: string;
  /** Teléfono de prueba (cumple el formato que exige la API). */
  telefono: string;
  /** Porcentaje de comisión de prueba (0-100). */
  porcentajeComision: number;
}

/** Servicio del catálogo de prueba. */
export interface ServicioLocalSpec {
  nombre: string;
  descripcion: string;
  precio: number;
  duracionMinutos: number;
}

/**
 * LOS DOS NEGOCIOS DEL ESCENARIO DE PRUEBA INICIAL.
 *
 * - `KYRIOS STUDIO` (slug `kyrios-studio`): Rubeiro y Santiago (cbalcazar).
 * - `BARBERÍA DEMO 2` (slug `barberia-demo-2`): Duvan y Javier.
 *
 * Los NOMBRES visibles de las personas son los que ya figuran en el código del
 * proyecto para esos correos. El nombre informal con el que las menciona el
 * propietario NO se usa para renombrar a nadie.
 */
export const NEGOCIOS_LOCALES: readonly NegocioLocalSpec[] = [
  {
    nombre: 'KYRIOS STUDIO',
    slug: 'kyrios-studio',
    superadmins: [
      {
        email: 'rromero@unicauca.edu.co',
        nombre: 'Rubeiro',
        apellido: 'Romero',
      },
      {
        email: 'cbalcazar@unicauca.edu.co',
        nombre: 'Santiago',
        apellido: 'Balcazar',
      },
    ],
    barberos: [
      {
        clave: 'barbero1',
        nombre: 'Barbero',
        apellido: 'Desarrollo KYRIOS 1',
        telefono: '+0000000001',
        porcentajeComision: 40,
      },
      {
        clave: 'barbero2',
        nombre: 'Barbero',
        apellido: 'Desarrollo KYRIOS 2',
        telefono: '+0000000002',
        porcentajeComision: 40,
      },
    ],
  },
  {
    nombre: 'BARBERÍA DEMO 2',
    slug: 'barberia-demo-2',
    superadmins: [
      {
        email: 'duvanfeli@unicauca.edu.co',
        nombre: 'Felipe',
        apellido: 'Armero',
      },
      {
        email: 'javieraceron@unicauca.edu.co',
        nombre: 'Javier Alexis',
        apellido: 'Anacona',
      },
    ],
    barberos: [
      {
        clave: 'barbero1',
        nombre: 'Barbero',
        apellido: 'Desarrollo DEMO 2 1',
        telefono: '+0000000003',
        porcentajeComision: 40,
      },
      {
        clave: 'barbero2',
        nombre: 'Barbero',
        apellido: 'Desarrollo DEMO 2 2',
        telefono: '+0000000004',
        porcentajeComision: 40,
      },
    ],
  },
];

/**
 * Catálogo de prueba (precios y duraciones FICTICIOS).
 *
 * Es el MISMO catálogo para las dos barberías: cada barbería tiene SU PROPIA
 * copia (el catálogo es por negocio), con los mismos valores de partida.
 */
export const SERVICIOS_LOCALES: readonly ServicioLocalSpec[] = [
  {
    nombre: 'Corte clásico',
    descripcion: 'Corte de cabello clásico, con lavado y peinado.',
    precio: 25000,
    duracionMinutos: 30,
  },
  {
    nombre: 'Degradado',
    descripcion: 'Degradado de Machine y Finish con perfilado.',
    precio: 30000,
    duracionMinutos: 45,
  },
  {
    nombre: 'Arreglo de barba',
    descripcion: 'Arreglo de barba con toalla caliente y navaja.',
    precio: 15000,
    duracionMinutos: 20,
  },
];

/**
 * Franja del horario semanal.
 *
 * Las franjas son de 60 minutos (regla de `FranjaFactory`: duración exacta,
 * alineada a bloques de una hora y dentro del rango 09:00-20:00) y la
 * disponibilidad las compara por su HORA DE INICIO.
 */
export interface FranjaSemanalSpec {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
}

/** Días de la semana con horario en el escenario de prueba. */
export const DIAS_SEMANA_LOCALES: readonly string[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
];

/**
 * Franjas de una jornada de prueba: de 09:00 a 13:00 en bloques de 60
 * minutos (cuatro franjas).
 */
export const FRANJAS_JORNADA_LOCALES: readonly FranjaSemanalSpec[] = [
  { dayOfWeek: '', startTime: '09:00', endTime: '10:00' },
  { dayOfWeek: '', startTime: '10:00', endTime: '11:00' },
  { dayOfWeek: '', startTime: '11:00', endTime: '12:00' },
  { dayOfWeek: '', startTime: '12:00', endTime: '13:00' },
];

/**
 * Construye el horario semanal completo (días de la semana × franjas de la
 * jornada).
 */
export function horarioSemanalLocal(): FranjaSemanalSpec[] {
  return DIAS_SEMANA_LOCALES.flatMap((dayOfWeek) =>
    FRANJAS_JORNADA_LOCALES.map((franja) => ({ ...franja, dayOfWeek })),
  );
}

/**
 * Claves de configuración del módulo de negocios (multitenant).
 *
 * Se declaran una sola vez para evitar literales duplicados entre el
 * middleware, el resolver y la documentación de despliegue.
 */
export const CLAVES_CONFIGURACION_NEGOCIO = {
  /**
   * Dominio base bajo el que se publican los subdominios de negocio.
   *
   * Sin este valor NO se resuelve el negocio por subdominio: la resolución
   * por cabecera sigue disponible si está habilitada. Ejemplo:
   * `NEGOCIO_DOMINIO_BASE=barberia.com` -> `acme.barberia.com` resuelve el
   * negocio de slug `acme`.
   */
  DOMINIO_BASE: 'NEGOCIO_DOMINIO_BASE',
  /**
   * Permite resolver el negocio mediante la cabecera `X-Negocio-Slug`.
   *
   * Es la alternativa controlada para clientes móviles, emuladores y entornos
   * que no pueden usar subdominios. Se restringe en producción fijando el
   * valor a `false` cuando el subdominio es el mecanismo principal.
   */
  PERMITIR_HEADER_SLUG: 'NEGOCIO_PERMITIR_HEADER_SLUG',
} as const;

/**
 * Cabecera HTTP con el slug público del negocio.
 *
 * Nunca transporta credenciales: solo selecciona el negocio. La autorización
 * se resuelve aparte contra la pertenencia del usuario a ese negocio.
 */
export const CABECERA_SLUG_NEGOCIO = 'x-negocio-slug';

/**
 * Formato aceptado para el slug de un negocio.
 *
 * Compatible con una etiqueta DNS (longitud 1..63, sin empezar ni terminar en
 * guion) y con la columna `negocios.slug` (`VARCHAR(63)`). Evita cortar o
 * filtrar identificadores con caracteres de control.
 */
export const REGEX_SLUG_NEGOCIO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Origen de la resolución del negocio, para auditoría y diagnóstico.
 */
export const ORIGEN_RESOLUCION_NEGOCIO = {
  SUBDOMINIO: 'SUBDOMINIO',
  CABECERA: 'CABECERA',
} as const;

export type OrigenResolucionNegocio =
  (typeof ORIGEN_RESOLUCION_NEGOCIO)[keyof typeof ORIGEN_RESOLUCION_NEGOCIO];

/**
 * Roles del personal.
 *
 * `ADMINISTRADOR` y `BARBERO` son roles OPERATIVOS: se derivan de las
 * MEMBRESÍAS (`Administrador` / `Barbero`) de la persona en un negocio, nunca
 * del campo global `Usuario.rol`.
 *
 * `SUPERADMIN` es un rol de NEGOCIO: se deriva de la membresía
 * `Administrador` con `superadmin = true` en ESE negocio. Su alcance es ese
 * negocio: en este SaaS no existe un superadmin de plataforma ni una sesión
 * de plataforma.
 *
 * Se declaran aquí, y no en el servicio de roles, para que el guard de
 * autorización (que vive en `src/auth`) no arrastre la cadena de importaciones
 * de Prisma.
 */
export const ROL_ADMINISTRADOR = 'ADMINISTRADOR';
export const ROL_BARBERO = 'BARBERO';
export const ROL_SUPERADMIN = 'SUPERADMIN';

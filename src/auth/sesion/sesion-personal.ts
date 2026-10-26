import { UnauthorizedException } from '@nestjs/common';
import { ROL_SUPERADMIN } from '../../modules/negocios/negocios.constants';

/**
 * Sesión de PERSONAL (barbería) verificada a partir de su token.
 *
 * Es la forma NORMALIZADA de lo que el guard deja en `request.user`. Los
 * servicios de autorización consumen esta sesión en lugar del campo global
 * `Usuario.rol`, que no dice en qué barbería se puede operar.
 */

/**
 * Ámbito de la sesión de personal.
 *
 * Solo existe `NEGOCIO`: en este SaaS no hay identidad de plataforma ni
 * sesión de plataforma. Toda sesión operativa está ligada a UNA barbería, y su
 * autorización depende de la membresía activa de la persona en ese negocio.
 */
export type AmbitoSesion = 'NEGOCIO';

/**
 * Sesión de PERSONAL (barbería) verificada a partir de su token.
 *
 * Es la forma NORMALIZADA de lo que el guard deja en `request.user`. Los
 * servicios de autorización consumen esta sesión en lugar del campo global
 * `Usuario.rol`, que no dice en qué barbería se puede operar.
 */

/**
 * `NEGOCIO`: sesión operativa vinculada a un negocio concreto. Autoriza las
 * rutas de reservas, clientes, servicios, horarios y usuarios de ESE negocio.
 */
export interface SesionPersonal {
  /** Identificador global de la persona (`Usuario.id`). */
  id: number;
  /** Correo de la identidad global. */
  email: string | null;
  /**
   * Roles efectivos de la sesión.
   *
   * Se derivan de las MEMBRESÍAS activas de la persona en el negocio de la
   * sesión: `SUPERADMIN` (membresía de administrador con `superadmin = true`),
   * `ADMINISTRADOR` y/o `BARBERO`. `Usuario.rol` no interviene.
   */
  roles: string[];
  /** Negocio de la sesión. */
  negocioId: number | null;
  /** Slug público del negocio de la sesión. */
  negocioSlug: string | null;
  /** Ámbito de la sesión. Siempre `NEGOCIO`. */
  ambito: AmbitoSesion;
  /**
   * Indica que la sesión incluye el rol `SUPERADMIN` **de su negocio**.
   *
   * Es un ATRIBUTO DERIVADO de `roles` (y no una identidad global): se
   * mantiene por compatibilidad del contrato, pero nunca sustituye la
   * comprobación de roles.
   */
  superadmin: boolean;
  /** Estado de la cuenta global en el momento de emitir la sesión. */
  estado: string;
  /** Foto de perfil de la sesión (perfil de barbero del negocio o Google). */
  fotoUrl: string | null;
}

/**
 * Actor de una petición: la identidad que autoriza, con sus roles EFECTIVOS
 * en el negocio de la sesión.
 *
 * Es lo que consumen los servicios de autorización
 * (`UsuariosAuthorizationService` y similares) en lugar del campo global
 * `Usuario.rol`.
 */
export interface ActorSesion {
  /** Identificador global de la persona. */
  id: number;
  /** Roles efectivos en el negocio de la sesión. */
  roles: string[];
  /**
   * `true` si la sesión incluye el rol `SUPERADMIN` **de su negocio**.
   * Derivado de `roles`; nunca un privilegio de plataforma.
   */
  superadmin: boolean;
  /** Negocio de la sesión. */
  negocioId: number | null;
}

/**
 * Marca de tipo que viaja DENTRO del token de personal.
 *
 * Es la segunda barrera frente a la confusedión entre clases de token: la
 * primera es el secreto (`JWT_SECRET` frente a `JWT_CLIENTE_SECRET`), que
 * son distintos por diseño.
 */
export const TIPO_TOKEN_PERSONAL = 'PERSONAL';

/**
 * Reclamaciones del token de personal.
 *
 * Nombres coherentes con los que ya usaba el proyecto (`sub`, `id`, `email`,
 * `nombre`, `apellido`, `rol`, `roles`, `estado`, `fotoUrl`).
 *
 * `rol` se conserva por compatibilidad con el contrato anterior, pero NO
 * autoriza nada: es el valor global heredado del modelo de negocio único. La
 * autorización usa `roles` (roles efectivos del negocio) y `negocioId`.
 */
export interface ClaimsSesionPersonal {
  sub: string;
  id: number;
  email: string;
  nombre: string;
  apellido: string;
  /** Marca de tipo de la sesión. Siempre `PERSONAL`. */
  tipo: string;
  /** Valor global heredado de `Usuario.rol`. Informativo, no autorizante. */
  rol: string;
  /** Roles efectivos de la sesión (derivados de las membresías). */
  roles: string[];
  /**
   * `true` si la sesión incluye `SUPERADMIN` **de su negocio**.
   *
   * Se deriva de `roles` al emitir y NO se toma del claim recibido: un token
   * antiguo que dijera `superadmin: true` no conserva ningún privilegio.
   */
  superadmin: boolean;
  /** Ámbito de la sesión. Siempre `NEGOCIO`. */
  ambito: AmbitoSesion;
  /** Identificador del negocio autorizado. */
  negocioId?: number;
  /** Slug del negocio autorizado. */
  negocioSlug?: string;
  /** Estado de la cuenta global al emitir la sesión. */
  estado: string;
  /** Foto de perfil (perfil de barbero del negocio o foto de Google). */
  fotoUrl: string | null;
}

/**
 * Extrae la sesión normalizada del contenido de un token de personal.
 *
 * Es DEFENSIVA: no confía en las reclamaciones recibidas, las valida y
 * rechaza cualquier payload que no describa una sesión coherente.
 *
 * @throws UnauthorizedException si el payload no describe una sesión válida.
 */
export function extraerSesionPersonal(payload: unknown): SesionPersonal {
  const contenido = (payload ?? {}) as Record<string, unknown>;

  const idCrudo = contenido.id ?? contenido.sub;
  const id = Number(idCrudo);

  if (!Number.isInteger(id) || id <= 0) {
    throw new UnauthorizedException(
      'El token no identifica a una persona válida',
    );
  }

  const roles = Array.isArray(contenido.roles)
    ? contenido.roles.filter((rol): rol is string => typeof rol === 'string')
    : [];

  const negocioIdCrudo = contenido.negocioId;
  const negocioId =
    typeof negocioIdCrudo === 'number' && Number.isInteger(negocioIdCrudo)
      ? negocioIdCrudo
      : null;

  return {
    id,
    email: typeof contenido.email === 'string' ? contenido.email : null,
    roles,
    negocioId,
    negocioSlug:
      typeof contenido.negocioSlug === 'string' ? contenido.negocioSlug : null,
    ambito: 'NEGOCIO',
    // El carácter SUPERADMIN se DERIVA de los roles efectivos: el claim
    // recibido no se acepta (un token antiguo no conserva privilegios).
    superadmin: roles.includes(ROL_SUPERADMIN),
    estado: typeof contenido.estado === 'string' ? contenido.estado : '',
    fotoUrl: typeof contenido.fotoUrl === 'string' ? contenido.fotoUrl : null,
  };
}

/**
 * Construye el actor de una petición a partir del token de personal.
 *
 * A diferencia de `extraerSesionPersonal`, NO lanza: un token sin
 * identificador produce un actor sin roles, que ningún servicio de
 * autorización considerará autorizado.
 */
export function construirActorSesion(payload: unknown): ActorSesion {
  const contenido = (payload ?? {}) as Record<string, unknown>;

  const idCrudo = contenido.id ?? contenido.sub;
  const id = Number(idCrudo);

  const roles = Array.isArray(contenido.roles)
    ? contenido.roles.filter((rol): rol is string => typeof rol === 'string')
    : [];

  const negocioIdCrudo = contenido.negocioId;

  return {
    id: Number.isInteger(id) && id > 0 ? id : 0,
    roles,
    // Derivado de los roles efectivos: nunca del claim global recibido.
    superadmin: roles.includes(ROL_SUPERADMIN),
    negocioId:
      typeof negocioIdCrudo === 'number' && Number.isInteger(negocioIdCrudo)
        ? negocioIdCrudo
        : null,
  };
}

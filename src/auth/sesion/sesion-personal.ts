import { UnauthorizedException } from '@nestjs/common';

/**
 * Sesión de PERSONAL (barbería) verificada a partir de su token.
 *
 * Es la forma NORMALIZADA de lo que el guard deja en `request.user`. Los
 * servicios de autorización consumen esta sesión en lugar del campo global
 * `Usuario.rol`, que no dice en qué barbería se puede operar.
 */

/** Ámbito de la sesión de personal. */
export type AmbitoSesion = 'NEGOCIO' | 'PLATAFORMA';

/**
 * `NEGOCIO`: sesión operativa vinculada a un negocio concreto. Autoriza las
 * rutas de reservas, clientes, servicios, horarios y usuarios de ESE negocio.
 *
 * `PLATAFORMA`: sesión global de la identidad `SUPERADMIN`. NO autoriza las
 * rutas de negocio: solo las rutas de plataforma marcadas de forma explícita.
 */
export interface SesionPersonal {
  /** Identificador global de la persona (`Usuario.id`). */
  id: number;
  /** Correo de la identidad global. */
  email: string | null;
  /**
   * Roles efectivos de la sesión.
   *
   * - Sesión de negocio: `ADMINISTRADOR` y/o `BARBERO` según los perfiles
   *   operativos ACTIVOS de la persona en ese negocio. `SUPERADMIN` aparece
   *   solo si la identidad global es de plataforma.
   * - Sesión de plataforma: `['SUPERADMIN']`.
   */
  roles: string[];
  /** Negocio de la sesión. `null` en la sesión global de plataforma. */
  negocioId: number | null;
  /** Slug público del negocio de la sesión. */
  negocioSlug: string | null;
  /** Ámbito de la sesión. */
  ambito: AmbitoSesion;
  /** Identidad global de plataforma (`Usuario.rol === 'SUPERADMIN'`). */
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
  /** Identidad global de plataforma. */
  superadmin: boolean;
  /** Negocio de la sesión. `null` en una sesión de plataforma. */
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
  /** Roles efectivos de la sesión. */
  roles: string[];
  /** Identidad global de plataforma. */
  superadmin: boolean;
  /** Ámbito de la sesión. */
  ambito: AmbitoSesion;
  /** Identificador del negocio autorizado. Ausente en sesión de plataforma. */
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

  const ambito: AmbitoSesion =
    contenido.ambito === 'PLATAFORMA' ? 'PLATAFORMA' : 'NEGOCIO';

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
    ambito,
    superadmin: contenido.superadmin === true,
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
    superadmin: contenido.superadmin === true,
    negocioId:
      typeof negocioIdCrudo === 'number' && Number.isInteger(negocioIdCrudo)
        ? negocioIdCrudo
        : null,
  };
}

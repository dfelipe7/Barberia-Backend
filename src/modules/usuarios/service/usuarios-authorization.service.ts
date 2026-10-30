import { Injectable, ForbiddenException } from '@nestjs/common';
import { ActorSesion } from '../../../auth/sesion/sesion-personal';
import {
  ROL_ADMINISTRADOR,
  ROL_BARBERO,
  ROL_SUPERADMIN,
} from '../../negocios/negocios.constants';

/**
 * Perfiles operativos de la persona OBJETIVO, tal y como los carga la base de
 * datos. `negocioId` es indispensable: sin él, un perfil de otra barbería
 * sería indistinguible del propio.
 */
interface PerfilesObjetivo {
  /** Identificador global de la persona. */
  id?: number;
  /** Valor global heredado (`Usuario.rol`). INFORMATIVO: no autoriza nada. */
  rol?: string;
  /**
   * Perfil de administrador de la persona: la MEMBRESÍA que concede los roles
   * administrativos EN UN NEGOCIO. `superadmin` indica que es SUPERADMIN de
   * ese negocio. (Perfil normalizado para la barbería activa).
   */
  administrador?: {
    estado?: string;
    negocioId?: number | null;
    superadmin?: boolean;
  } | null;
  /**
   * Multitenant (1:N): Colección de administradores devueltos por Prisma.
   * Permite evaluar permisos incluso si el objeto viene de base de datos sin normalizar.
   */
  administradores?: Array<{
    estado?: string;
    negocioId?: number | null;
    superadmin?: boolean;
  }>;
  /** Perfil de barbero de la persona (membresía normalizada en un negocio). */
  barbero?: { id?: number; negocioId?: number | null } | null;
  /**
   * Multitenant (1:N): Colección de barberos devueltos por Prisma.
   * Permite evaluar permisos incluso si el objeto viene de base de datos sin normalizar.
   */
  barberos?: Array<{ id?: number; negocioId?: number | null }>;
}

/**
 * Autorización de la gestión de USUARIOS dentro de una barbería.
 *
 * QUÉ ES EL ACTOR
 * ---------------
 * El actor es la SESIÓN (`ActorSesion`): la identidad global de la persona
 * con los roles EFECTIVOS en el negocio de la petición. NO se usa el campo
 * global `Usuario.rol` heredado (`ADMINISTRADOR` / `BARBERO`): ese valor no
 * dice en qué barbería se puede operar y conservarlo como fuente de
 * autorización sería una vía de elevación de privilegios entre negocios.
 *
 * ALCANCE DE LOS PERFILES DEL OBJETIVO
 * ------------------------------------
 * `Usuario.administrador` y `Usuario.barbero` se cargan como relación y la
 * extensión de Prisma NO filtra las relaciones incluidas: el perfil puede
 * pertenecer a OTRA barbería. Por eso toda comprobación de perfil se hace
 * contra el `negocioId` del actor.
 *
 * SUPERADMIN ES UN ROL DE NEGOCIO
 * -------------------------------
 * El carácter SUPERADMIN vive en la MEMBRESÍA (`Administrador.superadmin`) y
 * su alcance es el negocio de esa fila. `actor.superadmin` significa
 * "SUPERADMIN de SU barbería", nunca "superadmin de plataforma": por eso un
 * SUPERADMIN de A NO puede administrar a las personas de B, y la
 * comprobación es siempre contra el `negocioId` del actor.
 */
@Injectable()
export class UsuariosAuthorizationService {
  /**
   * Verifica si un usuario tiene permisos para VER la información detallada de otro usuario.
   *
   * REGLAS DE SEGURIDAD:
   * - SUPERADMIN (de SU negocio): Puede ver el perfil de cualquier persona de
   *   SU barbería.
   * - ADMINISTRADOR: Puede ver su propio perfil y el de cualquier Barbero de
   *   SU barbería (para gestionarlos).
   * - BARBERO: Solo puede ver su propio perfil. Nadie más.
   */
  verificarPermisosConsulta(
    actor: ActorSesion,
    usuarioObjetivo: PerfilesObjetivo,
  ) {
    // Toda persona puede consultarse a sí misma.
    if (actor.id === usuarioObjetivo.id) {
      return;
    }

    // El SUPERADMIN tiene autorización completa DENTRO de su barbería: el
    // objetivo debe tener una membresía en el mismo negocio.
    if (this.esSuperAdminDelNegocio(actor, usuarioObjetivo)) {
      return;
    }

    if (actor.roles.includes(ROL_ADMINISTRADOR)) {
      if (this.esBarberoDelNegocio(usuarioObjetivo, actor.negocioId)) {
        return;
      }

      throw new ForbiddenException(
        'No tienes permisos para consultar este usuario',
      );
    }

    if (actor.roles.includes(ROL_BARBERO)) {
      throw new ForbiddenException('Solo puedes consultar tu propio perfil');
    }

    throw new ForbiddenException(
      'No tienes permisos para consultar este usuario',
    );
  }

  /**
   * Verifica si un usuario tiene permisos para EDITAR la información de otro usuario.
   *
   * REGLAS DE SEGURIDAD:
   * - SUPERADMIN (de SU negocio): Puede editar el perfil de cualquier persona
   *   de SU barbería.
   * - ADMINISTRADOR: Puede editar su propio perfil y el de cualquier Barbero
   *   de su barbería. ¡NUNCA puede editar el perfil del SUPERADMIN de su
   *   barbería ni el de otro administrador de su barbería!
   * - BARBERO: Solo puede editar su propio perfil.
   */
  verificarPermisosEdicion(
    actor: ActorSesion,
    usuarioObjetivo: PerfilesObjetivo,
  ) {
    // Toda persona puede editar su propio perfil.
    if (actor.id === usuarioObjetivo.id) {
      return;
    }

    // El SUPERADMIN tiene autorización completa DENTRO de su barbería.
    if (this.esSuperAdminDelNegocio(actor, usuarioObjetivo)) {
      return;
    }

    if (actor.roles.includes(ROL_ADMINISTRADOR)) {
      if (this.esSuperAdmin(usuarioObjetivo, actor.negocioId)) {
        throw new ForbiddenException(
          'Un administrador no puede editar a un superadmin',
        );
      }

      // Un administrador nunca puede editar a otro administrador de su barbería
      if (this.esAdminDelNegocio(usuarioObjetivo, actor.negocioId)) {
        throw new ForbiddenException(
          'Un administrador no puede editar el perfil de otro administrador',
        );
      }

      if (this.esBarberoDelNegocio(usuarioObjetivo, actor.negocioId)) {
        return;
      }

      throw new ForbiddenException(
        'No tienes permisos para editar este usuario',
      );
    }

    if (actor.roles.includes(ROL_BARBERO)) {
      throw new ForbiddenException('Solo puedes editar tu propio perfil');
    }

    throw new ForbiddenException('No tienes permisos para editar este usuario');
  }

  /**
   * Verifica si un usuario tiene permisos para DESACTIVAR/ACTIVAR la "Cuenta Global" de otro usuario.
   * La cuenta global es el acceso al sistema (inicio de sesión).
   *
   * REGLAS DE SEGURIDAD:
   * - NADIE puede desactivar su propia cuenta global (medida anti-bloqueo accidental).
   * - SUPERADMIN (de SU negocio): Puede desactivar la cuenta de cualquier otra
   *   persona de SU barbería.
   * - ADMINISTRADOR: Solo puede desactivar la cuenta de los Barberos de su
   *   barbería. ¡NUNCA puede desactivar al SUPERADMIN de su barbería ni a
   *   otros Administradores!
   */
  verificarPermisosCambioEstadoCuenta(
    actor: ActorSesion,
    usuarioObjetivo: PerfilesObjetivo,
  ) {
    if (actor.id === usuarioObjetivo.id) {
      throw new ForbiddenException(
        'No puedes cambiar el estado de tu propio usuario (cuenta global)',
      );
    }

    // El SUPERADMIN tiene autorización completa DENTRO de su barbería.
    if (this.esSuperAdminDelNegocio(actor, usuarioObjetivo)) {
      return;
    }

    if (actor.roles.includes(ROL_ADMINISTRADOR)) {
      if (this.esSuperAdmin(usuarioObjetivo, actor.negocioId)) {
        throw new ForbiddenException(
          'Un administrador no puede cambiar el estado de un superadmin',
        );
      }

      // Un administrador nunca puede bloquear a otro administrador de su
      // barbería (aunque también sea barbero)
      if (this.esAdminDelNegocio(usuarioObjetivo, actor.negocioId)) {
        throw new ForbiddenException(
          'Un administrador no puede cambiar el estado de otro administrador',
        );
      }

      if (this.esBarberoDelNegocio(usuarioObjetivo, actor.negocioId)) {
        return;
      }

      throw new ForbiddenException(
        'Solo puedes cambiar el estado de los barberos',
      );
    }

    throw new ForbiddenException(
      'No tienes permisos para cambiar el estado de este usuario',
    );
  }

  /**
   * Verifica si un usuario tiene permisos para DESACTIVAR/ACTIVAR el "Perfil de Barbero".
   * Esto afecta si la persona aparece o no en el catálogo público para recibir citas.
   *
   * REGLAS DE SEGURIDAD:
   * - SUPERADMIN (de SU negocio): Puede desactivar el perfil de barbero de
   *   cualquiera de SU barbería.
   * - ADMINISTRADOR: Puede desactivar el perfil de barbero de cualquier barbero de su
   *   barbería o el suyo propio. ¡NUNCA puede tocar el perfil de barbero del
   *   SUPERADMIN de su barbería ni el de otro Administrador de su barbería!
   * - BARBERO: No puede cambiar el estado por sí solo (requiere gestión de un superior).
   */
  verificarPermisosCambioEstadoBarbero(
    actor: ActorSesion,
    usuarioObjetivo: PerfilesObjetivo,
  ) {
    // El SUPERADMIN tiene autorización completa DENTRO de su barbería.
    if (this.esSuperAdminDelNegocio(actor, usuarioObjetivo)) {
      return;
    }

    if (actor.roles.includes(ROL_ADMINISTRADOR)) {
      if (this.esSuperAdmin(usuarioObjetivo, actor.negocioId)) {
        throw new ForbiddenException(
          'Un administrador no puede cambiar el estado del perfil de barbero de un superadmin',
        );
      }

      const esSuPropioPerfil = actor.id === usuarioObjetivo.id;

      if (
        !esSuPropioPerfil &&
        this.esAdminDelNegocio(usuarioObjetivo, actor.negocioId)
      ) {
        throw new ForbiddenException(
          'Un administrador no puede cambiar el perfil de barbero de otro administrador',
        );
      }

      return;
    }

    throw new ForbiddenException(
      'No tienes permisos para cambiar el estado del perfil de este barbero',
    );
  }

  /**
   * Verifica si un usuario tiene permisos para MODIFICAR EL PORCENTAJE DE COMISIÓN de un barbero.
   *
   * REGLAS DE SEGURIDAD:
   * - SUPERADMIN y ADMINISTRADOR: Son los únicos autorizados para tocar datos
   *   financieros (comisiones), y solo dentro de SU barbería.
   * - BARBERO: Tiene estrictamente prohibido modificar su propia comisión o la de otros.
   */
  verificarPermisosComision(
    actor: ActorSesion,
    usuarioObjetivo: PerfilesObjetivo,
  ) {
    const esSuperAdmin = actor.roles.includes(ROL_SUPERADMIN);
    const esAdmin = actor.roles.includes(ROL_ADMINISTRADOR);

    if (!esSuperAdmin && !esAdmin) {
      throw new ForbiddenException(
        'No tienes permisos para modificar la comisión',
      );
    }

    if (
      esAdmin &&
      !esSuperAdmin &&
      this.esSuperAdmin(usuarioObjetivo, actor.negocioId)
    ) {
      throw new ForbiddenException(
        'Un administrador no puede modificar la comisión de un superadmin',
      );
    }

    // La comisión es un dato de la barbería del objetivo: si el objetivo no
    // pertenece al negocio del actor, no hay nada que modificar.
    if (
      !this.esBarberoDelNegocio(usuarioObjetivo, actor.negocioId) &&
      !this.esAdminDelNegocio(usuarioObjetivo, actor.negocioId)
    ) {
      throw new ForbiddenException(
        'No tienes permisos para modificar la comisión',
      );
    }
  }

  /**
   * El actor es SUPERADMIN y el objetivo pertenece a SU MISMO negocio.
   *
   * Es la condición que sustituye al antiguo "salto de comprobaciones" del
   * superadmin global: el poder del SUPERADMIN se agota en su barbería.
   */
  private esSuperAdminDelNegocio(
    actor: ActorSesion,
    usuarioObjetivo: PerfilesObjetivo,
  ): boolean {
    if (!actor.roles.includes(ROL_SUPERADMIN) || actor.negocioId === null) {
      return false;
    }

    return (
      this.esAdminDelNegocio(usuarioObjetivo, actor.negocioId) ||
      this.esBarberoDelNegocio(usuarioObjetivo, actor.negocioId)
    );
  }

  /**
   * El objetivo es SUPERADMIN **del negocio indicado** (el del actor).
   *
   * Ya no se mira el `Usuario.rol` global: el carácter SUPERADMIN es de la
   * MEMBRESÍA, de modo que "es superadmin" significa "es superadmin de esta
   * barbería".
   */
  /**
   * El objetivo es SUPERADMIN **del negocio indicado** (el del actor).
   *
   * Multitenant: Revisa tanto la propiedad singular normalizada (`administrador`)
   * como el arreglo de Prisma (`administradores[]`).
   */
  private esSuperAdmin(
    usuarioObjetivo: PerfilesObjetivo,
    negocioId: number | null,
  ): boolean {
    if (negocioId === null || !usuarioObjetivo) return false;

    // 1. Revisión en propiedad singular normalizada para este negocio
    const perfil = usuarioObjetivo.administrador;
    if (
      perfil &&
      perfil.negocioId === negocioId &&
      perfil.superadmin === true
    ) {
      return true;
    }

    // 2. Multitenant (1:N): Respaldo sobre la colección de Prisma si viene sin normalizar
    if (Array.isArray(usuarioObjetivo.administradores)) {
      return usuarioObjetivo.administradores.some(
        (a) => a.negocioId === negocioId && a.superadmin === true,
      );
    }

    return false;
  }

  /**
   * El objetivo tiene un perfil de administrador ACTIVO en el negocio del
   * actor. Un perfil de otra barbería (o sin negocio asignado) no cuenta.
   *
   * Multitenant: Revisa tanto la propiedad singular normalizada como el arreglo `administradores[]`.
   */
  private esAdminDelNegocio(
    usuarioObjetivo: PerfilesObjetivo,
    negocioId: number | null,
  ): boolean {
    if (negocioId === null || !usuarioObjetivo) return false;

    // 1. Revisión en propiedad singular normalizada para este negocio
    const perfil = usuarioObjetivo.administrador;
    if (
      perfil &&
      perfil.negocioId === negocioId &&
      perfil.estado === 'ACTIVO'
    ) {
      return true;
    }

    // 2. Multitenant (1:N): Respaldo sobre la colección de Prisma si viene sin normalizar
    if (Array.isArray(usuarioObjetivo.administradores)) {
      return usuarioObjetivo.administradores.some(
        (a) => a.negocioId === negocioId && a.estado === 'ACTIVO',
      );
    }

    return false;
  }

  /**
   * El objetivo tiene un perfil de barbero en el negocio del actor.
   *
   * Multitenant: Revisa tanto la propiedad singular normalizada como el arreglo `barberos[]`.
   */
  private esBarberoDelNegocio(
    usuarioObjetivo: PerfilesObjetivo,
    negocioId: number | null,
  ): boolean {
    if (negocioId === null || !usuarioObjetivo) return false;

    // 1. Revisión en propiedad singular normalizada para este negocio
    const perfil = usuarioObjetivo.barbero;
    if (perfil && perfil.negocioId === negocioId) {
      return true;
    }

    // 2. Multitenant (1:N): Respaldo sobre la colección de Prisma si viene sin normalizar
    if (Array.isArray(usuarioObjetivo.barberos)) {
      return usuarioObjetivo.barberos.some((b) => b.negocioId === negocioId);
    }

    return false;
  }
}

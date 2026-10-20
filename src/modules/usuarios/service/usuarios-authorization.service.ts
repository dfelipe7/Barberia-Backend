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
  /** Valor global heredado (`Usuario.rol`). */
  rol?: string;
  /** Perfil de administrador (único por persona en la plataforma actual). */
  administrador?: { estado?: string; negocioId?: number | null } | null;
  /** Perfil de barbero (único por persona en la plataforma actual). */
  barbero?: { id?: number; negocioId?: number | null } | null;
}

/**
 * Autorización de la gestión de USUARIOS dentro de una barbería.
 *
 * QUÉ ES EL ACTOR
 * ---------------
 * El actor es la SESIÓN (`ActorSesion`): la identidad global de la persona
 * con los roles EFECTIVOS en el negocio de la petición. NO se usa el campo
 * global `Usuario.rol` heredado (`ADMINISTRADOR` / `BARBERO`): ese valor no
 * dice en qué barbería se puede operar y conservarlo sería una vía de
 * elevación de privilegios entre negocios.
 *
 * ALCANCE DE LOS PERFILES DEL OBJETIVO
 * ------------------------------------
 * `Usuario.administrador` y `Usuario.barbero` se cargan como relación y la
 * extensión de Prisma NO filtra las relaciones incluidas: el perfil puede
 * pertenecer a OTRA barbería. Por eso toda comprobación de perfil se hace
 * contra el `negocioId` del actor.
 *
 * `SUPERADMIN` es la ÚNICA identidad global: se reconoce por
 * `actor.superadmin` y su alcance queda acotado por el `negocioId` que el
 * guard de autenticación ya cotejó con el contexto de la petición.
 */
@Injectable()
export class UsuariosAuthorizationService {
  /**
   * Verifica si un usuario tiene permisos para VER la información detallada de otro usuario.
   *
   * REGLAS DE SEGURIDAD:
   * - SUPERADMIN: Puede ver el perfil de cualquier persona.
   * - ADMINISTRADOR: Puede ver su propio perfil y el de cualquier Barbero de
   *   SU barbería (para gestionarlos).
   * - BARBERO: Solo puede ver su propio perfil. Nadie más.
   */
  verificarPermisosConsulta(
    actor: ActorSesion,
    usuarioObjetivo: PerfilesObjetivo,
  ) {
    if (actor.superadmin) {
      return;
    }

    const esSuPropioPerfil = actor.id === usuarioObjetivo.id;

    if (actor.roles.includes(ROL_ADMINISTRADOR)) {
      if (esSuPropioPerfil) {
        return;
      }

      if (this.esBarberoDelNegocio(usuarioObjetivo, actor.negocioId)) {
        return;
      }

      throw new ForbiddenException(
        'No tienes permisos para consultar este usuario',
      );
    }

    if (actor.roles.includes(ROL_BARBERO)) {
      if (esSuPropioPerfil) {
        return;
      }

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
   * - SUPERADMIN: Puede editar el perfil de cualquier persona.
   * - ADMINISTRADOR: Puede editar su propio perfil y el de cualquier Barbero
   *   de su barbería. ¡NUNCA puede editar el perfil de un SUPERADMIN ni el de
   *   otro administrador de su barbería!
   * - BARBERO: Solo puede editar su propio perfil.
   */
  verificarPermisosEdicion(
    actor: ActorSesion,
    usuarioObjetivo: PerfilesObjetivo,
  ) {
    if (actor.superadmin) {
      return;
    }

    if (actor.roles.includes(ROL_ADMINISTRADOR)) {
      if (this.esSuperAdmin(usuarioObjetivo)) {
        throw new ForbiddenException(
          'Un administrador no puede editar a un superadmin',
        );
      }

      const esSuPropioPerfil = actor.id === usuarioObjetivo.id;
      if (esSuPropioPerfil) {
        return;
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
      const esSuPropioPerfil = actor.id === usuarioObjetivo.id;

      if (!esSuPropioPerfil) {
        throw new ForbiddenException('Solo puedes editar tu propio perfil');
      }
      return;
    }

    throw new ForbiddenException('No tienes permisos para editar este usuario');
  }

  /**
   * Verifica si un usuario tiene permisos para DESACTIVAR/ACTIVAR la "Cuenta Global" de otro usuario.
   * La cuenta global es el acceso total al sistema (inicio de sesión).
   *
   * REGLAS DE SEGURIDAD:
   * - NADIE puede desactivar su propia cuenta global (medida anti-bloqueo accidental).
   * - SUPERADMIN: Puede desactivar la cuenta de cualquier otra persona.
   * - ADMINISTRADOR: Solo puede desactivar la cuenta de los Barberos de su
   *   barbería. ¡NUNCA puede desactivar a un SUPERADMIN ni a otros
   *   Administradores!
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

    if (actor.superadmin) {
      return;
    }

    if (actor.roles.includes(ROL_ADMINISTRADOR)) {
      if (this.esSuperAdmin(usuarioObjetivo)) {
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
   * - SUPERADMIN: Puede desactivar el perfil de barbero de cualquiera (incluido él mismo si es barbero).
   * - ADMINISTRADOR: Puede desactivar el perfil de barbero de cualquier barbero de su
   *   barbería o el suyo propio. ¡NUNCA puede tocar el perfil de barbero de un
   *   SUPERADMIN ni de otro Administrador de su barbería!
   * - BARBERO: No puede cambiar el estado por sí solo (requiere gestión de un superior).
   */
  verificarPermisosCambioEstadoBarbero(
    actor: ActorSesion,
    usuarioObjetivo: PerfilesObjetivo,
  ) {
    if (actor.superadmin) {
      return;
    }

    if (actor.roles.includes(ROL_ADMINISTRADOR)) {
      if (this.esSuperAdmin(usuarioObjetivo)) {
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
   * - SUPERADMIN y ADMINISTRADOR: Son los únicos autorizados para tocar datos financieros (comisiones).
   * - BARBERO: Tiene estrictamente prohibido modificar su propia comisión o la de otros.
   */
  verificarPermisosComision(
    actor: ActorSesion,
    usuarioObjetivo: PerfilesObjetivo,
  ) {
    const esSuperAdmin = actor.superadmin;
    const esAdmin = actor.roles.includes(ROL_ADMINISTRADOR);

    if (!esSuperAdmin && !esAdmin) {
      throw new ForbiddenException(
        'No tienes permisos para modificar la comisión',
      );
    }

    if (esAdmin && !esSuperAdmin && this.esSuperAdmin(usuarioObjetivo)) {
      throw new ForbiddenException(
        'Un administrador no puede modificar la comisión de un superadmin',
      );
    }
  }

  /** El objetivo es una identidad global de plataforma. */
  private esSuperAdmin(usuarioObjetivo: PerfilesObjetivo): boolean {
    return usuarioObjetivo?.rol === ROL_SUPERADMIN;
  }

  /**
   * El objetivo tiene un perfil de administrador ACTIVO en el negocio del
   * actor. Un perfil de otra barbería (o sin negocio asignado) no cuenta.
   */
  private esAdminDelNegocio(
    usuarioObjetivo: PerfilesObjetivo,
    negocioId: number | null,
  ): boolean {
    const perfil = usuarioObjetivo?.administrador;

    return (
      !!perfil &&
      negocioId !== null &&
      perfil.negocioId === negocioId &&
      perfil.estado === 'ACTIVO'
    );
  }

  /** El objetivo tiene un perfil de barbero en el negocio del actor. */
  private esBarberoDelNegocio(
    usuarioObjetivo: PerfilesObjetivo,
    negocioId: number | null,
  ): boolean {
    const perfil = usuarioObjetivo?.barbero;

    return !!perfil && negocioId !== null && perfil.negocioId === negocioId;
  }
}

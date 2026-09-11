import { Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class UsuariosAuthorizationService {
  /**
   * Verifica si un usuario tiene permisos para VER la información detallada de otro usuario.
   * 
   * REGLAS DE SEGURIDAD:
   * - SUPERADMIN: Puede ver el perfil de cualquier persona.
   * - ADMINISTRADOR: Puede ver su propio perfil y el de cualquier Barbero (para gestionarlos).
   * - BARBERO: Solo puede ver su propio perfil. Nadie más.
   */
  verificarPermisosConsulta(usuarioActual: any, usuarioObjetivo: any) {
    if (usuarioActual.rol === 'SUPERADMIN') {
      return;
    }

    if (usuarioActual.rol === 'ADMINISTRADOR') {
      const esSuPropioPerfil = usuarioActual.id === usuarioObjetivo.id;
      const esBarbero = usuarioObjetivo.barbero !== null;

      if (esSuPropioPerfil || esBarbero) {
        return;
      }

      throw new ForbiddenException('No tienes permisos para consultar este usuario');
    }

    if (usuarioActual.rol === 'BARBERO') {
      const esSuPropioPerfil = usuarioActual.id === usuarioObjetivo.id;
      if (esSuPropioPerfil) {
        return;
      }

      throw new ForbiddenException('Solo puedes consultar tu propio perfil');
    }

    throw new ForbiddenException('No tienes permisos para consultar este usuario');
  }

  /**
   * Verifica si un usuario tiene permisos para EDITAR la información de otro usuario.
   * 
   * REGLAS DE SEGURIDAD:
   * - SUPERADMIN: Puede editar el perfil de cualquier persona.
   * - ADMINISTRADOR: Puede editar su propio perfil y el de cualquier Barbero. 
   *   ¡NUNCA puede editar el perfil de un SUPERADMIN!
   * - BARBERO: Solo puede editar su propio perfil.
   */
  verificarPermisosEdicion(usuarioActual: any, usuarioObjetivo: any) {
    if (usuarioActual.rol === 'SUPERADMIN') {
      return;
    }

    if (usuarioActual.rol === 'ADMINISTRADOR') {
      if (usuarioObjetivo.rol === 'SUPERADMIN') {
        throw new ForbiddenException('Un administrador no puede editar a un superadmin');
      }

      const esSuPropioPerfil = usuarioActual.id === usuarioObjetivo.id;
      if (esSuPropioPerfil) {
        return;
      }

      // Un administrador nunca puede editar a otro administrador activo
      const esOtroAdmin =
        usuarioObjetivo.rol === 'ADMINISTRADOR' ||
        (usuarioObjetivo.administrador !== null &&
          usuarioObjetivo.administrador.estado === 'ACTIVO');

      if (esOtroAdmin) {
        throw new ForbiddenException('Un administrador no puede editar el perfil de otro administrador');
      }

      const esBarbero = usuarioObjetivo.barbero !== null;
      if (!esBarbero) {
        throw new ForbiddenException('No tienes permisos para editar este usuario');
      }
      return;
    }

    if (usuarioActual.rol === 'BARBERO') {
      const esSuPropioPerfil = usuarioActual.id === usuarioObjetivo.id;

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
   * - ADMINISTRADOR: Solo puede desactivar la cuenta de los Barberos puros. 
   *   ¡NUNCA puede desactivar a un SUPERADMIN ni a otros Administradores!
   */
  verificarPermisosCambioEstadoCuenta(usuarioActual: any, usuarioObjetivo: any) {
    if (usuarioActual.id === usuarioObjetivo.id) {
      throw new ForbiddenException('No puedes cambiar el estado de tu propio usuario (cuenta global)');
    }

    if (usuarioActual.rol === 'SUPERADMIN') {
      return;
    }

    if (usuarioActual.rol === 'ADMINISTRADOR') {
      if (usuarioObjetivo.rol === 'SUPERADMIN') {
        throw new ForbiddenException('Un administrador no puede cambiar el estado de un superadmin');
      }

      // Un administrador nunca puede bloquear a otro administrador activo (aunque también sea barbero)
      const esOtroAdmin =
        usuarioObjetivo.rol === 'ADMINISTRADOR' ||
        (usuarioObjetivo.administrador !== null &&
          usuarioObjetivo.administrador.estado === 'ACTIVO');

      if (esOtroAdmin) {
        throw new ForbiddenException('Un administrador no puede cambiar el estado de otro administrador');
      }

      const esBarbero = usuarioObjetivo.barbero !== null;
      if (!esBarbero) {
        throw new ForbiddenException('Solo puedes cambiar el estado de los barberos');
      }
      return;
    }

    throw new ForbiddenException('No tienes permisos para cambiar el estado de este usuario');
  }

  /**
   * Verifica si un usuario tiene permisos para DESACTIVAR/ACTIVAR el "Perfil de Barbero".
   * Esto afecta si la persona aparece o no en el catálogo público para recibir citas.
   * 
   * REGLAS DE SEGURIDAD:
   * - SUPERADMIN: Puede desactivar el perfil de barbero de cualquiera (incluido él mismo si es barbero).
   * - ADMINISTRADOR: Puede desactivar el perfil de barbero de cualquier barbero puro o el suyo propio.
   *   ¡NUNCA puede tocar el perfil de barbero de un SUPERADMIN ni de otro Administrador!
   * - BARBERO: No puede cambiar el estado por sí solo (requiere gestión de un superior).
   */
  verificarPermisosCambioEstadoBarbero(usuarioActual: any, usuarioObjetivo: any) {
    if (usuarioActual.rol === 'SUPERADMIN') {
      return;
    }

    if (usuarioActual.rol === 'ADMINISTRADOR') {
      if (usuarioObjetivo.rol === 'SUPERADMIN') {
        throw new ForbiddenException('Un administrador no puede cambiar el estado del perfil de barbero de un superadmin');
      }

      const esSuPropioPerfil = usuarioActual.id === usuarioObjetivo.id;
      const esOtroAdmin =
        usuarioObjetivo.rol === 'ADMINISTRADOR' ||
        (usuarioObjetivo.administrador !== null &&
          usuarioObjetivo.administrador.estado === 'ACTIVO');

      if (!esSuPropioPerfil && esOtroAdmin) {
        throw new ForbiddenException('Un administrador no puede cambiar el perfil de barbero de otro administrador');
      }

      return;
    }

    throw new ForbiddenException('No tienes permisos para cambiar el estado del perfil de este barbero');
  }

  /**
   * Verifica si un usuario tiene permisos para MODIFICAR EL PORCENTAJE DE COMISIÓN de un barbero.
   * 
   * REGLAS DE SEGURIDAD:
   * - SUPERADMIN y ADMINISTRADOR: Son los únicos autorizados para tocar datos financieros (comisiones).
   * - BARBERO: Tiene estrictamente prohibido modificar su propia comisión o la de otros.
   */
  verificarPermisosComision(usuarioActual: any) {
    if (
      usuarioActual.rol !== 'SUPERADMIN' &&
      usuarioActual.rol !== 'ADMINISTRADOR'
    ) {
      throw new ForbiddenException('No tienes permisos para modificar la comisión');
    }
  }
}

import { Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class UsuariosAuthorizationService {
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

  verificarPermisosEdicion(usuarioActual: any, usuarioObjetivo: any) {
    if (usuarioActual.rol === 'SUPERADMIN') {
      return;
    }

    if (usuarioActual.rol === 'ADMINISTRADOR') {
      if (usuarioObjetivo.rol === 'SUPERADMIN') {
        throw new ForbiddenException('Un administrador no puede editar a un superadmin');
      }

      const esSuPropioPerfil = usuarioActual.id === usuarioObjetivo.id;
      const esBarbero = usuarioObjetivo.barbero !== null;

      if (!esSuPropioPerfil && !esBarbero) {
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

      const esBarbero = usuarioObjetivo.barbero !== null;

      if (!esBarbero) {
        throw new ForbiddenException('Solo puedes cambiar el estado de los barberos');
      }
      return;
    }

    throw new ForbiddenException('No tienes permisos para cambiar el estado de este usuario');
  }

  verificarPermisosCambioEstadoBarbero(usuarioActual: any, usuarioObjetivo: any) {
    if (usuarioActual.rol === 'SUPERADMIN') {
      return;
    }

    if (usuarioActual.rol === 'ADMINISTRADOR') {
      if (usuarioObjetivo.rol === 'SUPERADMIN') {
        throw new ForbiddenException('Un administrador no puede cambiar el estado del perfil de barbero de un superadmin');
      }
      // Un administrador puede cambiar el estado de cualquier barbero (incluido él mismo si es barbero)
      return;
    }

    throw new ForbiddenException('No tienes permisos para cambiar el estado del perfil de este barbero');
  }

  verificarPermisosComision(usuarioActual: any) {
    if (
      usuarioActual.rol !== 'SUPERADMIN' &&
      usuarioActual.rol !== 'ADMINISTRADOR'
    ) {
      throw new ForbiddenException('No tienes permisos para modificar la comisión');
    }
  }
}

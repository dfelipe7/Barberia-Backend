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

  verificarPermisosCambioEstado(usuarioActual: any, usuarioObjetivo: any) {
    if (usuarioActual.id === usuarioObjetivo.id) {
      throw new ForbiddenException('No puedes cambiar el estado de tu propio usuario');
    }

    if (usuarioActual.rol === 'SUPERADMIN') {
      return;
    }

    if (usuarioActual.rol === 'ADMINISTRADOR') {
      const esBarbero = usuarioObjetivo.barbero !== null;

      if (!esBarbero) {
        throw new ForbiddenException('Solo puedes cambiar el estado de los barberos');
      }
      return;
    }

    throw new ForbiddenException('No tienes permisos para cambiar el estado de este usuario');
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

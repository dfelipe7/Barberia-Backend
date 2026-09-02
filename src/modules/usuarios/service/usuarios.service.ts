import {
  ConflictException,
  Injectable,
} from '@nestjs/common';

import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { ActualizarUsuarioDto } from '../dto/actualizar-usuario.dto';
import { CambiarEstadoUsuarioDto } from '../dto/cambiar-estado-usuario.dto';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';

@Injectable()
export class UsuariosService {
  constructor(
    private readonly usuariosRepository: UsuariosRepository,
    private readonly keycloakService: KeycloakService,
    private readonly authorizationService: UsuariosAuthorizationService,
  ) {}

  async sincronizarSuperadmin() {
    const superadmins = await this.keycloakService.obtenerUsuariosPorRol('SUPERADMIN');

    if (superadmins.length === 0) {
      throw new ConflictException('No existe ningún SUPERADMIN en Keycloak');
    }

    if (superadmins.length > 1) {
      throw new ConflictException('Existe más de un SUPERADMIN en Keycloak');
    }

    const superadmin = superadmins[0];

    const usuarioExistente = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(superadmin.id);

    if (usuarioExistente) {
      return {
        mensaje: 'El SUPERADMIN ya existe en la base de datos',
        usuario: usuarioExistente,
      };
    }

    const usuario = await this.usuariosRepository.crearUsuario({
      keycloakId: superadmin.id,
      email: superadmin.email,
      nombre: superadmin.firstName ?? '',
      apellido: superadmin.lastName ?? '',
      rol: 'SUPERADMIN',
    });

    return {
      mensaje: 'SUPERADMIN sincronizado correctamente',
      usuario,
    };
  }

  async obtenerUsuarioPorId(usuarioId: number, usuarioAutenticado: any) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const usuarioActual = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(usuarioAutenticado.sub);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosConsulta(usuarioActual, usuario);

    return usuario;
  }

  async actualizarUsuario(usuarioId: number, dto: ActualizarUsuarioDto, usuarioAutenticado: any) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const usuarioActual = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(usuarioAutenticado.sub);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosEdicion(usuarioActual, usuario);

    await this.keycloakService.actualizarUsuario(usuario.keycloakId, {
      email: dto.email,
      nombre: dto.nombre,
      apellido: dto.apellido,
    });

    return this.usuariosRepository.actualizarUsuario(usuarioId, {
      email: dto.email,
      nombre: dto.nombre,
      apellido: dto.apellido,
    });
  }

  async cambiarEstadoUsuario(usuarioId: number, dto: CambiarEstadoUsuarioDto, usuarioAutenticado: any) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const usuarioActual = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(usuarioAutenticado.sub);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosCambioEstado(usuarioActual, usuario);

    const nuevoEstado = dto.estado;
    const activo = nuevoEstado === EstadoUsuario.ACTIVO;

    await this.keycloakService.cambiarEstadoUsuario(usuario.keycloakId, activo);

    return this.usuariosRepository.actualizarEstadoUsuario(usuarioId, nuevoEstado);
  }
}
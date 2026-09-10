import {
  ConflictException,
  Injectable,
  Inject,
  forwardRef,
} from '@nestjs/common';

import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { BarberosRepository } from '../repository/barberos.repository';
import { ActualizarUsuarioDto } from '../dto/actualizar-usuario.dto';
import { CambiarEstadoUsuarioDto } from '../dto/cambiar-estado-usuario.dto';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { AdministradoresService } from './administradores.service';
import { BarberosService } from './barberos.service';

@Injectable()
export class UsuariosService {
  constructor(
    private readonly usuariosRepository: UsuariosRepository,
    private readonly barberosRepository: BarberosRepository,
    private readonly keycloakService: KeycloakService,
    private readonly authorizationService: UsuariosAuthorizationService,
    @Inject(forwardRef(() => AdministradoresService))
    private readonly administradoresService: AdministradoresService,
    @Inject(forwardRef(() => BarberosService))
    private readonly barberosService: BarberosService,
  ) {}

  /**
   * Sincroniza al usuario SUPERADMIN inicial desde Keycloak a la base de datos local.
   * Se usa típicamente una vez al configurar el sistema por primera vez.
   */
  async sincronizarSuperadmin() {
    const superadmins = await this.keycloakService.obtenerUsuariosPorRol('SUPERADMIN');

    if (superadmins.length === 0) {
      throw new ConflictException('No existe ningún SUPERADMIN en Keycloak');
    }

    const resultados: any[] = [];

    for (const superadmin of superadmins) {
      const usuarioExistente = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(superadmin.id);

      if (usuarioExistente) {
        await this.keycloakService.cambiarEstadoUsuario(superadmin.id, true);
        await this.usuariosRepository.actualizarEstadoUsuario(usuarioExistente.id, EstadoUsuario.ACTIVO);
        resultados.push({
          mensaje: `El SUPERADMIN ${superadmin.email} ya existe en la base de datos y su estado fue verificado como ACTIVO`,
          usuario: usuarioExistente,
        });
        continue;
      }

      const usuario = await this.usuariosRepository.crearUsuario({
        keycloakId: superadmin.id,
        email: superadmin.email,
        nombre: superadmin.firstName ?? '',
        apellido: superadmin.lastName ?? '',
        rol: 'SUPERADMIN',
      });

      resultados.push({
        mensaje: `SUPERADMIN ${superadmin.email} sincronizado correctamente`,
        usuario,
      });
    }

    return resultados;
  }

  /**
   * Obtiene el perfil del usuario autenticado en base a su ID de Keycloak.
   */
  async obtenerMiPerfil(usuarioAutenticado: any) {
    const usuarioActual = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(usuarioAutenticado.sub);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    return usuarioActual;
  }

  /**
   * Obtiene los datos de un usuario específico por su ID numérico.
   * Valida que el usuario que realiza la petición tenga permisos para verlo.
   */
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

  /**
   * Actualiza el nombre, apellido y correo de un usuario.
   * Refleja los cambios tanto en Keycloak como en la base de datos local.
   * Si el usuario es un barbero y se envían datos extra, actualiza el perfil de barbero.
   */
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

    // 1. Actualizar datos personales en Keycloak y MySQL (si se enviaron)
    if (dto.email || dto.nombre || dto.apellido) {
      await this.keycloakService.actualizarUsuario(usuario.keycloakId, {
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
      });

      await this.usuariosRepository.actualizarUsuario(usuarioId, {
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
      });
    }

    // 2. Gestionar Rol de Administrador
    if (dto.esAdministrador !== undefined && usuario.rol !== 'SUPERADMIN') {
      const estadoAdminActual = usuario.administrador?.estado === 'ACTIVO';
      if (dto.esAdministrador !== estadoAdminActual) {
        if (usuarioActual.id === usuario.id && !dto.esAdministrador) {
          throw new ConflictException('No puedes remover tu propio rol de Administrador');
        }
        await this.administradoresService.cambiarEstadoAdministrador(
          usuarioId,
          dto.esAdministrador ? 'ACTIVO' : 'INACTIVO',
        );
      }
    }

    // 3. Gestionar Rol de Barbero
    if (dto.esBarbero !== undefined) {
      const estadoBarberoActual = usuario.barbero?.estado === 'ACTIVO';
      if (dto.esBarbero !== estadoBarberoActual) {
        if (dto.esBarbero) {
          await this.barberosService.configurarBarberoPorId(usuarioId, {
            telefono: dto.telefono || usuario.barbero?.telefono || '',
            porcentajeComision:
              dto.porcentajeComision ??
              (usuario.barbero?.porcentajeComision
                ? Number(usuario.barbero.porcentajeComision)
                : 50),
          });
        } else {
          await this.barberosService.cambiarEstadoBarbero(
            usuarioId,
            { estado: EstadoUsuario.INACTIVO },
            usuarioAutenticado,
          );
        }
      } else if (
        usuario.barbero &&
        (dto.telefono || dto.porcentajeComision !== undefined)
      ) {
        await this.barberosRepository.actualizarPerfilBarbero(usuarioId, {
          telefono: dto.telefono,
          porcentajeComision: dto.porcentajeComision,
        });
      }
    } else if (
      usuario.barbero &&
      (dto.telefono || dto.porcentajeComision !== undefined)
    ) {
      await this.barberosRepository.actualizarPerfilBarbero(usuarioId, {
        telefono: dto.telefono,
        porcentajeComision: dto.porcentajeComision,
      });
    }

    return this.usuariosRepository.obtenerUsuarioPorId(usuarioId);
  }

  /**
   * Cambia el estado de la cuenta global del usuario (ACTIVO/INACTIVO).
   * Al inactivar, bloquea el acceso en Keycloak, impidiendo el inicio de sesión.
   * NOTA: Esta acción solo afecta el acceso global. Los roles (admin/barbero)
   * mantienen su propio estado independiente. Si el usuario queda sin roles
   * activos al desbloquear, el administrador deberá restaurarlos manualmente.
   */
  async cambiarEstadoUsuario(usuarioId: number, dto: CambiarEstadoUsuarioDto, usuarioAutenticado: any) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const usuarioActual = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(usuarioAutenticado.sub);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosCambioEstadoCuenta(usuarioActual, usuario);

    const nuevoEstado = dto.estado;
    const activo = nuevoEstado === EstadoUsuario.ACTIVO;

    await this.keycloakService.cambiarEstadoUsuario(usuario.keycloakId, activo);

    return this.usuariosRepository.actualizarEstadoUsuario(usuarioId, nuevoEstado);
  }
}
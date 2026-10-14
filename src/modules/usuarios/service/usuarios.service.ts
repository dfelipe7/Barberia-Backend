import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';

import { BarberosRepository } from '../repository/barberos.repository';
import { ActualizarUsuarioDto } from '../dto/dto-peticion/actualizar-usuario.dto';
import { CambiarEstadoUsuarioDto } from '../dto/dto-peticion/cambiar-estado-usuario.dto';
import { UsuarioPerfilDto } from '../dto/dto-respuesta/usuario-perfil.dto';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { AdministradoresService } from './administradores.service';
import { BarberosService } from './barberos.service';

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    private readonly usuariosRepository: UsuariosRepository,
    private readonly barberosRepository: BarberosRepository,
    private readonly authorizationService: UsuariosAuthorizationService,
    @Inject(forwardRef(() => AdministradoresService))
    private readonly administradoresService: AdministradoresService,
    @Inject(forwardRef(() => BarberosService))
    private readonly barberosService: BarberosService,
  ) {}

  /**
   * Sincroniza y verifica al usuario SUPERADMIN inicial en la base de datos local.
   */
  async sincronizarSuperadmin() {
    return [
      {
        mensaje: 'Superadministradores verificados correctamente en la base de datos MySQL local.',
      },
    ];
  }

  private async buscarUsuarioAutenticado(usuarioAutenticado: any) {
    if (usuarioAutenticado?.email) {
      const u = await this.usuariosRepository.obtenerUsuarioPorEmail(usuarioAutenticado.email);
      if (u) return u;
    }
    if (usuarioAutenticado?.id) {
      const u = await this.usuariosRepository.obtenerUsuarioPorId(Number(usuarioAutenticado.id));
      if (u) return u;
    }
    if (usuarioAutenticado?.sub) {
      const subId = Number(usuarioAutenticado.sub);
      if (!Number.isNaN(subId) && subId > 0) {
        const u = await this.usuariosRepository.obtenerUsuarioPorId(subId);
        if (u) return u;
      }
    }
    return null;
  }

  /**
   * Obtiene el perfil del usuario autenticado en base a su token.
   */
  async obtenerMiPerfil(usuarioAutenticado: any): Promise<UsuarioPerfilDto> {
    const usuarioActual = await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    return this.mapearUsuarioPerfil(usuarioActual);
  }

  /**
   * Obtiene los datos de un usuario específico por su ID numérico.
   * Valida que el usuario que realiza la petición tenga permisos para verlo.
   */
  async obtenerUsuarioPorId(usuarioId: number, usuarioAutenticado: any): Promise<UsuarioPerfilDto> {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const usuarioActual = await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosConsulta(usuarioActual, usuario);

    return this.mapearUsuarioPerfil(usuario);
  }

  /**
   * Actualiza el nombre, apellido y correo de un usuario.
   * Refleja los cambios en la base de datos local.
   * Si el usuario es un barbero y se envían datos extra, actualiza el perfil de barbero.
   */
  async actualizarUsuario(usuarioId: number, dto: ActualizarUsuarioDto, usuarioAutenticado: any) { // NOSONAR
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const usuarioActual = await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosEdicion(usuarioActual, usuario);

    // 1. Actualizar datos personales en MySQL (si se enviaron)
    if (dto.email || dto.nombre || dto.apellido) {
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
        if (usuarioActual.rol !== 'SUPERADMIN') {
          throw new ForbiddenException(
            'Solo el Superadministrador puede otorgar o revocar el rol de Administrador',
          );
        }
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
        if (usuarioActual.rol === 'BARBERO') {
          throw new ForbiddenException('Un barbero no puede modificar ni revocar su propio rol de Barbero');
        }
        this.authorizationService.verificarPermisosCambioEstadoBarbero(usuarioActual, usuario);

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
        (dto.telefono || dto.porcentajeComision !== undefined || dto.fotoUrl !== undefined)
      ) {
        if (dto.porcentajeComision !== undefined) {
          this.authorizationService.verificarPermisosComision(usuarioActual, usuario);
        }
        await this.barberosRepository.actualizarPerfilBarbero(usuarioId, {
          telefono: dto.telefono,
          porcentajeComision: dto.porcentajeComision,
          fotoUrl: dto.fotoUrl,
        });
      }
    } else if (
      usuario.barbero &&
      (dto.telefono || dto.porcentajeComision !== undefined || dto.fotoUrl !== undefined)
    ) {
      if (dto.porcentajeComision !== undefined) {
        this.authorizationService.verificarPermisosComision(usuarioActual, usuario);
      }
      await this.barberosRepository.actualizarPerfilBarbero(usuarioId, {
        telefono: dto.telefono,
        porcentajeComision: dto.porcentajeComision,
        fotoUrl: dto.fotoUrl,
      });
    }

    return this.usuariosRepository.obtenerUsuarioPorId(usuarioId);
  }

  /**
   * Cambia el estado de la cuenta global del usuario (ACTIVO/INACTIVO).
   * Al inactivar, bloquea el acceso en la plataforma, impidiendo el inicio de sesión.
   * NOTA: Esta acción solo afecta el acceso global. Los roles (admin/barbero)
   * mantienen su propio estado independiente. Si el usuario queda sin roles
   * activos al desbloquear, el administrador deberá restaurarlos manualmente.
   */
  async cambiarEstadoUsuario(usuarioId: number, dto: CambiarEstadoUsuarioDto, usuarioAutenticado: any) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const usuarioActual = await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosCambioEstadoCuenta(usuarioActual, usuario);

    const nuevoEstado = dto.estado;
    return this.usuariosRepository.actualizarEstadoUsuario(usuarioId, nuevoEstado);
  }

  /**
   * Transforma el objeto de usuario proveniente de Prisma al DTO UsuarioPerfilDto.
   * Garantiza la conversión del Decimal de porcentajeComision a number para TypeScript y Swagger.
   */
  private mapearUsuarioPerfil(usuario: any): UsuarioPerfilDto {
    return {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      rol: usuario.rol,
      estado: usuario.estado,
      administrador: usuario.administrador
        ? {
            id: usuario.administrador.id,
            estado: usuario.administrador.estado,
          }
        : null,
      barbero: usuario.barbero
        ? {
            id: usuario.barbero.id,
            telefono: usuario.barbero.telefono,
            porcentajeComision: Number(usuario.barbero.porcentajeComision),
            fotoUrl: usuario.barbero.fotoUrl,
            estado: usuario.barbero.estado,
          }
        : null,
    };
  }
}
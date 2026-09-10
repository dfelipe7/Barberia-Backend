import { Injectable, ConflictException } from '@nestjs/common';
import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberosRepository } from '../repository/barberos.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { CrearBarberoDto } from '../dto/crear-barbero.dto';
import { ConfigurarBarberoDto } from '../dto/configurar-barbero.dto';
import { ActualizarComisionDto } from '../dto/actualizar-comision.dto';
import { BarberoCatalogoDto } from '../dto/barbero-catalogo.dto';
import { CambiarEstadoUsuarioDto } from '../dto/cambiar-estado-usuario.dto';
import { EstadoUsuario } from '../../../../generated/prisma/enums';

@Injectable()
export class BarberosService {
  constructor(
    private readonly barberosRepository: BarberosRepository,
    private readonly usuariosRepository: UsuariosRepository,
    private readonly keycloakService: KeycloakService,
    private readonly authorizationService: UsuariosAuthorizationService,
  ) {}

  /**
   * Crea un nuevo empleado barbero desde cero.
   * Lo registra en Keycloak con el rol BARBERO y crea su perfil en MySQL.
   */
  async crearBarbero(dto: CrearBarberoDto) {
    const usuarioExistente = await this.usuariosRepository.obtenerUsuarioPorEmail(dto.email);
    if (usuarioExistente) {
      throw new ConflictException('Ya existe un usuario en el sistema con este correo electrónico.');
    }
    const keycloakId = await this.keycloakService.crearUsuario(
      dto.email,
      dto.password,
      dto.nombre,
      dto.apellido,
    );

    await this.keycloakService.asignarRol(keycloakId, 'BARBERO');

    try {
      const usuario = await this.usuariosRepository.crearUsuario({
        keycloakId,
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
        rol: 'BARBERO',
      });

      const barbero = await this.barberosRepository.crearBarberoNuevo({
        usuarioId: usuario.id,
        telefono: dto.telefono,
        porcentajeComision: dto.porcentajeComision,
      });

      return {
        mensaje: 'Barbero creado correctamente',
        barbero,
      };
    } catch (error) {
      console.error('Error guardando barbero en la base de datos:', error);
      throw new ConflictException('El barbero no pudo registrarse en la base de datos');
    }
  }

  /**
   * Configura el perfil de barbero para el usuario que hace la petición (Auto-asignación).
   * Requiere que el usuario ya exista y no tenga un perfil de barbero previo.
   */
  async configurarBarbero(keycloakId: string, dto: ConfigurarBarberoDto) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(keycloakId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (usuario.barbero) {
      if ((usuario.barbero as any).estado === 'ACTIVO') {
        throw new ConflictException('El usuario ya está configurado como barbero');
      } else {
        // Reactivar si existía inactivo
        await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');
        await this.barberosRepository.actualizarEstadoBarbero(usuario.id, EstadoUsuario.ACTIVO);
        return this.barberosRepository.actualizarPerfilBarbero(usuario.id, {
          telefono: dto.telefono,
          porcentajeComision: dto.porcentajeComision,
        });
      }
    }

    await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');

    return this.barberosRepository.crearPerfilBarbero({
      usuarioId: usuario.id,
      telefono: dto.telefono,
      porcentajeComision: dto.porcentajeComision,
    });
  }

  /**
   * Configura el perfil de barbero para un usuario específico (Por ID).
   * Restringido a administradores.
   */
  async configurarBarberoPorId(usuarioId: number, dto: ConfigurarBarberoDto) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (usuario.barbero) {
      if ((usuario.barbero as any).estado === 'ACTIVO') {
        throw new ConflictException('El usuario ya está configurado como barbero');
      } else {
        // Reactivar
        await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');
        await this.barberosRepository.actualizarEstadoBarbero(usuario.id, EstadoUsuario.ACTIVO);
        
        return this.barberosRepository.actualizarPerfilBarbero(usuario.id, {
          telefono: dto.telefono,
          porcentajeComision: dto.porcentajeComision,
        });
      }
    }

    if (!usuario.administrador && usuario.rol !== 'SUPERADMIN') {
      throw new ConflictException('El usuario no es un administrador ni superadmin');
    }

    await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');

    return this.barberosRepository.crearPerfilBarbero({
      usuarioId: usuario.id,
      telefono: dto.telefono,
      porcentajeComision: dto.porcentajeComision,
    });
  }

  /**
   * Actualiza el porcentaje de comisión que gana un barbero por sus servicios.
   */
  async actualizarComision(usuarioId: number, dto: ActualizarComisionDto, usuarioAutenticado: any) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (!usuario.barbero) {
      throw new ConflictException('El usuario no es un barbero');
    }

    const usuarioActual = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(usuarioAutenticado.sub);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosComision(usuarioActual);

    return this.barberosRepository.actualizarComision(usuarioId, dto.porcentajeComision);
  }

  /**
   * Obtiene la lista de barberos para el catálogo público.
   * Filtra barberos inactivos y oculta datos sensibles (comisión, email).
   */
  async obtenerBarberosCatalogo(): Promise<BarberoCatalogoDto[]> {
    const barberos = await this.barberosRepository.obtenerBarberosCatalogo();

    return barberos.map((barbero) => ({
      id: barbero.id,
      nombre: barbero.usuario.nombre,
      apellido: barbero.usuario.apellido,
      telefono: barbero.telefono,
    }));
  }

  /**
   * Obtiene la lista completa de barberos para la gestión interna.
   * Incluye datos sensibles como la comisión y el correo.
   */
  async obtenerBarberosGestion() {
    const barberos = await this.barberosRepository.obtenerBarberosGestion();

    return barberos.map((barbero) => ({
      id: barbero.usuario.id,
      nombre: barbero.usuario.nombre,
      apellido: barbero.usuario.apellido,
      email: barbero.usuario.email,
      telefono: barbero.telefono,
      porcentajeComision: Number(barbero.porcentajeComision),
      estado: barbero.estado,
      esAdministrador: barbero.usuario.administrador && (barbero.usuario.administrador as any).estado === 'ACTIVO',
      estadoAdmin: barbero.usuario.administrador ? (barbero.usuario.administrador as any).estado : undefined,
      estadoGlobal: barbero.usuario.estado,
    }));
  }

  /**
   * Cambia el estado del perfil de barbero (ACTIVO/INACTIVO).
   * Si se inactiva, se le quita el rol BARBERO en Keycloak para ocultarlo del catálogo,
   * pero su cuenta global sigue funcionando.
   */
  async cambiarEstadoBarbero(usuarioId: number, dto: CambiarEstadoUsuarioDto, usuarioAutenticado: any) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (!usuario.barbero) {
      throw new ConflictException('El usuario no es un barbero');
    }

    const usuarioActual = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(usuarioAutenticado.sub);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosCambioEstadoBarbero(usuarioActual, usuario);

    const nuevoEstado = dto.estado;
    const activo = nuevoEstado === EstadoUsuario.ACTIVO;

    if (activo) {
      await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');
    } else {
      await this.keycloakService.quitarRol(usuario.keycloakId, 'BARBERO');

      const esAdminActivo = usuario.administrador?.estado === EstadoUsuario.ACTIVO || usuario.rol === 'ADMINISTRADOR';
      const esSuperAdmin = usuario.rol === 'SUPERADMIN';
      if (!esSuperAdmin && !esAdminActivo) {
        await this.keycloakService.cambiarEstadoUsuario(usuario.keycloakId, false);
        await this.usuariosRepository.actualizarEstadoUsuario(usuarioId, EstadoUsuario.INACTIVO);
      }
    }

    return this.barberosRepository.actualizarEstadoBarbero(usuarioId, nuevoEstado);
  }
}

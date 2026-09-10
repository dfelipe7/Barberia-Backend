import { Injectable, ConflictException } from '@nestjs/common';
import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { AdministradoresRepository } from '../repository/administradores.repository';
import { CrearAdministradorDto } from '../dto/crear-administrador.dto';

@Injectable()
export class AdministradoresService {
  constructor(
    private readonly administradoresRepository: AdministradoresRepository,
    private readonly usuariosRepository: UsuariosRepository,
    private readonly keycloakService: KeycloakService,
  ) {}

  /**
   * Registra a un nuevo administrador/gerente en el sistema.
   * Crea el usuario en Keycloak con el rol ADMINISTRADOR y genera su perfil en MySQL.
   * Exclusivo para el SUPERADMIN.
   */
  async crearAdministrador(dto: CrearAdministradorDto) {
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

    await this.keycloakService.asignarRol(keycloakId, 'ADMINISTRADOR');

    try {
      const usuario = await this.usuariosRepository.crearUsuario({
        keycloakId,
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido ?? '',
        rol: 'ADMINISTRADOR',
      });

      const administrador = await this.administradoresRepository.crearAdministrador({
        usuarioId: usuario.id,
      });

      return {
        mensaje: 'Administrador creado correctamente',
        administrador,
      };
    } catch (error) {
      console.error('Error guardando administrador en la base de datos:', error);
      throw new ConflictException('El administrador no pudo registrarse en la base de datos');
    }
  }

  /**
   * Obtiene la lista completa de todos los administradores del sistema.
   * Exclusivo para la tabla de gestión del SUPERADMIN.
   */
  async obtenerAdministradores() {
    const administradores = await this.administradoresRepository.obtenerAdministradores();

    return administradores.map((administrador: any) => ({
      id: administrador.usuario.id,
      nombre: administrador.usuario.nombre,
      apellido: administrador.usuario.apellido,
      email: administrador.usuario.email,
      estado: administrador.usuario.estado, // Estado de la cuenta global
      estadoAdmin: administrador.estado, // Estado del rol de administrador
      esBarbero: administrador.usuario.barbero !== null,
      estadoBarbero: administrador.usuario.barbero?.estado,
    }));
  }
  /**
   * Cambia el estado del rol de ADMINISTRADOR (ACTIVO/INACTIVO) para un usuario.
   * Si se inactiva, se le quita la etiqueta en Keycloak y se hace Soft Delete de su perfil.
   * Si es su único rol, se bloquea su cuenta global.
   */
  async cambiarEstadoAdministrador(usuarioId: number, estado: string) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (usuario.rol === 'SUPERADMIN') {
      throw new ConflictException('No se pueden modificar los privilegios del SUPERADMIN');
    }

    const activo = estado === 'ACTIVO';

    if (activo) {
      if (usuario.administrador && (usuario.administrador as any).estado === 'ACTIVO') {
        throw new ConflictException('Este usuario ya tiene privilegios de Administrador');
      }

      await this.keycloakService.asignarRol(usuario.keycloakId, 'ADMINISTRADOR');

      try {
        if (usuario.rol === 'BARBERO') {
          await this.usuariosRepository.actualizarRol(usuario.id, 'ADMINISTRADOR');
        }

        const adminExistente = await this.administradoresRepository.obtenerAdministradorPorUsuarioId(usuario.id);
        
        let administrador;
        if (adminExistente) {
          administrador = await this.administradoresRepository.actualizarEstadoAdministrador(usuario.id, 'ACTIVO');
        } else {
          administrador = await this.administradoresRepository.crearAdministrador({
            usuarioId: usuario.id,
          });
        }

        return {
          mensaje: 'Usuario promovido a Administrador exitosamente',
          administrador,
        };
      } catch (error) {
        console.error('Error promoviendo al administrador en la base de datos:', error);
        throw new ConflictException('No se pudo promover al usuario en la base de datos local');
      }
    } else {
      if (!usuario.administrador) {
        throw new ConflictException('Este usuario no tiene privilegios de Administrador');
      }

      await this.keycloakService.quitarRol(usuario.keycloakId, 'ADMINISTRADOR');

      try {
        if (usuario.barbero) {
          await this.usuariosRepository.actualizarRol(usuario.id, 'BARBERO');
        }

        await this.administradoresRepository.actualizarEstadoAdministrador(usuario.id, 'INACTIVO');

        const esBarberoActivo = usuario.barbero?.estado === 'ACTIVO';
        if (!esBarberoActivo) {
          await this.keycloakService.cambiarEstadoUsuario(usuario.keycloakId, false);
          await this.usuariosRepository.actualizarEstadoUsuario(usuario.id, 'INACTIVO');
        }

        return {
          mensaje: 'Se han revocado los privilegios de Administrador exitosamente',
        };
      } catch (error) {
        console.error('Error degradando al administrador en la base de datos:', error);
        throw new ConflictException('No se pudo degradar al usuario en la base de datos local');
      }
    }
  }
}

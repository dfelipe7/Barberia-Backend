import { Injectable, ConflictException, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberosRepository } from '../repository/barberos.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { CrearBarberoDto } from '../dto/dto-peticion/crear-barbero.dto';
import { ConfigurarBarberoDto } from '../dto/dto-peticion/configurar-barbero.dto';
import { ActualizarComisionDto } from '../dto/dto-peticion/actualizar-comision.dto';
import { CambiarEstadoUsuarioDto } from '../dto/dto-peticion/cambiar-estado-usuario.dto';
import { FiltroBarberosDto } from '../dto/dto-peticion/filtro-barberos.dto';
import { BarberoCatalogoDto } from '../dto/dto-respuesta/barbero-catalogo.dto';
import { BarberoGestionDto } from '../dto/dto-respuesta/barbero-gestion.dto';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class BarberosService {
  private readonly logger = new Logger(BarberosService.name);

  constructor(
    private readonly barberosRepository: BarberosRepository,
    private readonly usuariosRepository: UsuariosRepository,
    private readonly keycloakService: KeycloakService,
    private readonly authorizationService: UsuariosAuthorizationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Crea un nuevo empleado barbero desde cero.
   * Crea el usuario en MySQL con rol BARBERO y su perfil asociado.
   * Si se provee contraseña y Keycloak está activo, también sincroniza en Keycloak.
   */
  async crearBarbero(dto: CrearBarberoDto) {
    const usuarioExistente = await this.usuariosRepository.obtenerUsuarioPorEmail(dto.email);
    if (usuarioExistente) {
      throw new ConflictException('Ya existe un usuario en el sistema con este correo electrónico.');
    }

    let keycloakId: string | null = null;
    if (dto.password) {
      try {
        keycloakId = await this.keycloakService.crearUsuario(
          dto.email,
          dto.password,
          dto.nombre,
          dto.apellido,
        );
        await this.keycloakService.asignarRol(keycloakId, 'BARBERO');
      } catch (err: any) {
        this.logger.warn(`No se pudo crear en Keycloak (creando en MySQL): ${err?.message}`);
      }
    }

    try {
      const barbero = await this.prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.create({
          data: {
            keycloakId,
            email: dto.email,
            nombre: dto.nombre,
            apellido: dto.apellido,
            rol: 'BARBERO',
          },
        });

        return tx.barbero.create({
          data: {
            usuarioId: usuario.id,
            telefono: dto.telefono,
            porcentajeComision: dto.porcentajeComision,
            fotoUrl: dto.fotoUrl,
          },
        });
      });

      return {
        mensaje: 'Barbero creado correctamente',
        barbero,
      };
    } catch (error) {
      console.error('Error guardando barbero en la base de datos (Rollback ejecutado):', error);
      // Compensación manual: Borramos el usuario de Keycloak si se llegó a crear
      if (keycloakId) {
        try {
          await this.keycloakService.eliminarUsuario(keycloakId);
        } catch (err: any) {
          this.logger.warn(`No se pudo eliminar en Keycloak en rollback: ${err?.message}`);
        }
      }
      throw new ConflictException('El barbero no pudo registrarse. Se han revertido los cambios en el sistema.');
    }
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
      const u = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(usuarioAutenticado.sub);
      if (u) return u;
    }
    return null;
  }

  /**
   * Configura el perfil de barbero para el usuario que hace la petición (Auto-asignación).
   * Requiere que el usuario ya exista y no tenga un perfil de barbero previo.
   */
  async configurarBarbero(identificador: string, dto: ConfigurarBarberoDto) {
    const usuario =
      (await this.usuariosRepository.obtenerUsuarioPorEmail(identificador)) ??
      (await this.usuariosRepository.obtenerUsuarioPorId(Number(identificador) || 0)) ??
      (await this.usuariosRepository.obtenerUsuarioPorKeycloakId(identificador));

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (usuario.barbero) {
      if ((usuario.barbero as any).estado === 'ACTIVO') {
        throw new ConflictException('El usuario ya está configurado como barbero');
      } else {
        // Reactivar si existía inactivo
        if (usuario.keycloakId) {
          try {
            await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');
          } catch (error: any) {
            this.logger.warn(`No se pudo asignar rol en Keycloak (posiblemente offline): ${error?.message}`);
          }
        }
        await this.barberosRepository.actualizarEstadoBarbero(usuario.id, EstadoUsuario.ACTIVO);
        return this.barberosRepository.actualizarPerfilBarbero(usuario.id, {
          telefono: dto.telefono,
          porcentajeComision: dto.porcentajeComision,
        });
      }
    }

    if (usuario.keycloakId) {
      try {
        await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');
      } catch (error: any) {
        this.logger.warn(`No se pudo asignar rol en Keycloak (posiblemente offline): ${error?.message}`);
      }
    }

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
        if (usuario.keycloakId) {
          try {
            await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');
          } catch (error: any) {
            this.logger.warn(`No se pudo asignar rol en Keycloak (posiblemente offline): ${error?.message}`);
          }
        }
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

    if (usuario.keycloakId) {
      try {
        await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');
      } catch (error: any) {
        this.logger.warn(`No se pudo asignar rol en Keycloak (posiblemente offline): ${error?.message}`);
      }
    }

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

    const usuarioActual = await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }
    this.authorizationService.verificarPermisosComision(usuarioActual, usuario);
    return this.barberosRepository.actualizarComision(usuarioId, dto.porcentajeComision);
  }

  /**
   * Obtiene la lista de barberos para el catálogo público.
   * Filtra barberos inactivos y oculta datos sensibles (comisión, email).
   */
  async obtenerBarberosCatalogo(filtro?: FiltroBarberosDto): Promise<BarberoCatalogoDto[]> {
    const barberos = await this.barberosRepository.obtenerBarberosCatalogo(filtro);

    return barberos.map((barbero) => ({
      id: barbero.id,
      nombre: barbero.usuario.nombre,
      apellido: barbero.usuario.apellido,
      telefono: barbero.telefono,
      fotoUrl: barbero.fotoUrl,
    }));
  }

  /**
   * Obtiene la lista completa de barberos para la gestión interna.
   * Incluye datos sensibles como la comisión y el correo.
   */
  async obtenerBarberosGestion(filtro?: FiltroBarberosDto): Promise<BarberoGestionDto[]> {
    const barberos = await this.barberosRepository.obtenerBarberosGestion(filtro);

    return barberos.map((barbero) => ({
      id: barbero.usuario.id,
      nombre: barbero.usuario.nombre,
      apellido: barbero.usuario.apellido,
      email: barbero.usuario.email,
      telefono: barbero.telefono,
      porcentajeComision: Number(barbero.porcentajeComision),
      estado: barbero.estado,
      fotoUrl: barbero.fotoUrl,
      esAdministrador: Boolean(barbero.usuario.administrador && (barbero.usuario.administrador as any).estado === 'ACTIVO'),
      esSuperAdmin: barbero.usuario.rol === 'SUPERADMIN',
      estadoAdmin: barbero.usuario.administrador ? (barbero.usuario.administrador as any).estado : undefined,
      estadoGlobal: barbero.usuario.estado,
    }));
  }

  /**
   * Sube y actualiza la foto de perfil de un barbero.
   * Si ya tenía una foto previa en /uploads, la elimina para evitar acumular archivos huérfanos.
   */
  async subirFotoBarbero(usuarioId: number, archivo: Express.Multer.File, usuarioAutenticado?: any) { // NOSONAR
    if (!archivo) {
      throw new ConflictException('No se ha proporcionado ningún archivo de imagen');
    }

    const barbero = await this.barberosRepository.obtenerBarberoPorUsuarioId(usuarioId);
    if (!barbero) {
      try {
        fs.unlinkSync(archivo.path);
      } catch {}
      throw new ConflictException('El usuario no cuenta con un perfil de barbero registrado');
    }

    if (usuarioAutenticado) {
      const usuarioObjetivo = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);
      const usuarioActual = await this.buscarUsuarioAutenticado(usuarioAutenticado);
      if (usuarioActual && usuarioObjetivo) {
        try {
          this.authorizationService.verificarPermisosEdicion(usuarioActual, usuarioObjetivo);
        } catch (error) {
          try {
            fs.unlinkSync(archivo.path);
          } catch {}
          throw error;
        }
      }
    }

    // Si ya tenía una foto previa en /uploads, la eliminamos del disco
    if (barbero.fotoUrl?.startsWith('/uploads/')) {
      const rutaAnterior = join(process.cwd(), barbero.fotoUrl);
      if (fs.existsSync(rutaAnterior)) {
        try {
          fs.unlinkSync(rutaAnterior);
        } catch (e) {
          console.warn('No se pudo eliminar la foto anterior:', e);
        }
      }
    }

    const nuevaFotoUrl = `/uploads/barberos/${archivo.filename}`;
    await this.barberosRepository.actualizarPerfilBarbero(usuarioId, {
      fotoUrl: nuevaFotoUrl,
    });

    return {
      mensaje: 'Foto de perfil actualizada correctamente',
      fotoUrl: nuevaFotoUrl,
    };
  }

  /**
   * Elimina la foto de perfil del barbero y borra el archivo físico.
   */
  async eliminarFotoBarbero(usuarioId: number) {
    const barbero = await this.barberosRepository.obtenerBarberoPorUsuarioId(usuarioId);
    if (!barbero) {
      throw new ConflictException('El usuario no cuenta con un perfil de barbero');
    }

    if (barbero.fotoUrl?.startsWith('/uploads/')) {
      const ruta = join(process.cwd(), barbero.fotoUrl);
      if (fs.existsSync(ruta)) {
        try {
          fs.unlinkSync(ruta);
        } catch (e) {
          console.warn('No se pudo eliminar el archivo físico de la foto:', e);
        }
      }
    }

    await this.barberosRepository.actualizarPerfilBarbero(usuarioId, {
      fotoUrl: null,
    });

    return {
      mensaje: 'Foto de perfil eliminada correctamente',
      fotoUrl: null,
    };
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

    const usuarioActual = await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosCambioEstadoBarbero(usuarioActual, usuario);

    const nuevoEstado = dto.estado;
    const activo = nuevoEstado === EstadoUsuario.ACTIVO;

    if (activo) {
      if (usuario.keycloakId) {
        try {
          await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');
        } catch (error: any) {
          this.logger.warn(`No se pudo asignar rol en Keycloak (posiblemente offline): ${error?.message}`);
        }
      }
    } else {
      if (usuario.keycloakId) {
        try {
          await this.keycloakService.quitarRol(usuario.keycloakId, 'BARBERO');
        } catch (error: any) {
          this.logger.warn(`No se pudo quitar rol en Keycloak (posiblemente offline): ${error?.message}`);
        }
      }

      const esAdminActivo = usuario.administrador?.estado === EstadoUsuario.ACTIVO || usuario.rol === 'ADMINISTRADOR';
      const esSuperAdmin = usuario.rol === 'SUPERADMIN';
      if (!esSuperAdmin && !esAdminActivo) {
        if (usuario.keycloakId) {
          try {
            await this.keycloakService.cambiarEstadoUsuario(usuario.keycloakId, false);
          } catch (error: any) {
            this.logger.warn(`No se pudo cambiar estado en Keycloak (posiblemente offline): ${error?.message}`);
          }
        }
        await this.usuariosRepository.actualizarEstadoUsuario(usuarioId, EstadoUsuario.INACTIVO);
      }
    }

    return this.barberosRepository.actualizarEstadoBarbero(usuarioId, nuevoEstado);
  }
}

import { Injectable, ConflictException, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import { join } from 'node:path';
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
import { construirActorSesion } from '../../../auth/sesion/sesion-personal';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';

@Injectable()
export class BarberosService {
  private readonly logger = new Logger(BarberosService.name);

  constructor(
    private readonly barberosRepository: BarberosRepository,
    private readonly usuariosRepository: UsuariosRepository,
    private readonly authorizationService: UsuariosAuthorizationService,
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  /**
   * Perfil de BARBERO de la persona en el NEGOCIO ACTIVO.
   *
   * Una persona puede ser barbero en varias barberías (el perfil es único por
   * negocio), así que el perfil que cuenta es SIEMPRE el de la barbería de la
   * petición. Las relaciones cargadas por Prisma no las filtra la extensión de
   * aislamiento, de modo que el filtro se aplica aquí de forma explícita.
   */
  private perfilBarberoEnNegocio(usuario: any) {
    const negocioId = this.aislamiento.negocioIdRequerido();

    return (
      (usuario?.barberos ?? []).find(
        (perfil: any) => perfil.negocioId === negocioId,
      ) ?? null
    );
  }

  /**
   * Perfil de ADMINISTRADOR de la persona en el NEGOCIO ACTIVO.
   *
   * Mismo criterio que `perfilBarberoEnNegocio`: una persona puede ser
   * administradora de varias barberías.
   */
  private perfilAdministradorEnNegocio(usuario: any) {
    const negocioId = this.aislamiento.negocioIdRequerido();

    return (
      (usuario?.administradores ?? []).find(
        (perfil: any) => perfil.negocioId === negocioId,
      ) ?? null
    );
  }

  /**
   * Crea un nuevo empleado barbero desde cero.
   * Crea el usuario en MySQL con rol PERSONAL y su perfil asociado en el
   * negocio activo.
   */
  async crearBarbero(dto: CrearBarberoDto) {
    const negocioId = this.aislamiento.negocioIdRequerido();
    const emailNormalizado = dto.email.toLowerCase().trim();

    const usuarioExistente =
      await this.usuariosRepository.obtenerUsuarioPorEmail(emailNormalizado);

    if (usuarioExistente) {
      // Verificar si ya tiene perfil de barbero en este negocio específico
      const barberoEnNegocio = await this.prisma.barbero.findUnique({
        where: {
          negocioId_usuarioId: {
            negocioId,
            usuarioId: usuarioExistente.id,
          },
        },
      });

      if (barberoEnNegocio) {
        if (barberoEnNegocio.estado === 'ACTIVO') {
          throw new ConflictException(
            'Este usuario ya se encuentra registrado como barbero en esta barbería.',
          );
        } else {
          // Si estaba inactivo en esta sede, reactivarlo con la nueva comisión y teléfono
          const barberoReactivado = await this.prisma.barbero.update({
            where: { id: barberoEnNegocio.id },
            data: {
              estado: 'ACTIVO',
              telefono: dto.telefono,
              porcentajeComision: dto.porcentajeComision,
              fotoUrl: dto.fotoUrl ?? barberoEnNegocio.fotoUrl,
            },
          });
          return {
            mensaje: 'El barbero fue reactivado exitosamente en esta barbería.',
            barbero: barberoReactivado,
          };
        }
      }

      // El usuario existe en la plataforma (otra sede), vincularlo como barbero a esta sede
      try {
        const barbero = await this.prisma.barbero.create({
          data: {
            usuarioId: usuarioExistente.id,
            negocioId,
            telefono: dto.telefono,
            porcentajeComision: dto.porcentajeComision,
            fotoUrl: dto.fotoUrl,
            estado: 'ACTIVO',
          },
        });

        this.logger.log(
          `AUDIT: Barbero existente en red vinculado a la sede ${negocioId}. Email: ${emailNormalizado}`,
        );

        return {
          mensaje:
            'Usuario vinculado exitosamente como barbero en esta barbería.',
          barbero,
        };
      } catch (error) {
        this.logger.error(
          'Error vinculando barbero existente a la sede:',
          error,
        );
        throw new ConflictException(
          'El barbero no pudo vincularse a esta barbería. Intente nuevamente.',
        );
      }
    }

    try {
      const barbero = await this.prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.create({
          data: {
            email: emailNormalizado,
            nombre: dto.nombre.trim(),
            apellido: dto.apellido.trim(),
            // El rol global ya no distingue administrador de barbero: los
            // roles efectivos se derivan del perfil del negocio.
            rol: 'PERSONAL',
          },
        });

        return tx.barbero.create({
          data: {
            usuarioId: usuario.id,
            telefono: dto.telefono,
            porcentajeComision: dto.porcentajeComision,
            fotoUrl: dto.fotoUrl,
            negocioId,
          },
        });
      });

      return {
        mensaje: 'Barbero creado correctamente',
        barbero,
      };
    } catch (error) {
      this.logger.error('Error guardando barbero en la base de datos:', error);
      throw new ConflictException(
        'El barbero no pudo registrarse. Intente nuevamente.',
      );
    }
  }

  private async buscarUsuarioAutenticado(usuarioAutenticado: any) {
    if (usuarioAutenticado?.email) {
      const u = await this.usuariosRepository.obtenerUsuarioPorEmail(
        usuarioAutenticado.email,
      );
      if (u) return u;
    }
    const idNum = Number(usuarioAutenticado?.id || usuarioAutenticado?.sub);
    if (!Number.isNaN(idNum) && idNum > 0) {
      const u = await this.usuariosRepository.obtenerUsuarioPorId(idNum);
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
   * Configura el perfil de barbero para el usuario que hace la petición (Auto-asignación).
   * Requiere que el usuario ya exista y no tenga un perfil de barbero previo.
   */
  async configurarBarbero(identificador: string, dto: ConfigurarBarberoDto) {
    const idNum = Number(identificador);
    const usuario =
      (!Number.isNaN(idNum) && idNum > 0
        ? await this.usuariosRepository.obtenerUsuarioPorId(idNum)
        : null) ??
      (await this.usuariosRepository.obtenerUsuarioPorEmail(identificador));

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const perfilBarbero = this.perfilBarberoEnNegocio(usuario);

    if (perfilBarbero) {
      if (perfilBarbero.estado === 'ACTIVO') {
        throw new ConflictException(
          'El usuario ya está configurado como barbero',
        );
      } else {
        await this.barberosRepository.actualizarEstadoBarbero(
          usuario.id,
          EstadoUsuario.ACTIVO,
        );
        return this.barberosRepository.actualizarPerfilBarbero(usuario.id, {
          telefono: dto.telefono,
          porcentajeComision: dto.porcentajeComision,
        });
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
    const usuario =
      await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const perfilBarbero = this.perfilBarberoEnNegocio(usuario);

    if (perfilBarbero) {
      if (perfilBarbero.estado === 'ACTIVO') {
        throw new ConflictException(
          'El usuario ya está configurado como barbero',
        );
      } else {
        await this.barberosRepository.actualizarEstadoBarbero(
          usuario.id,
          EstadoUsuario.ACTIVO,
        );

        return this.barberosRepository.actualizarPerfilBarbero(usuario.id, {
          telefono: dto.telefono,
          porcentajeComision: dto.porcentajeComision,
        });
      }
    }

    if (!this.perfilAdministradorEnNegocio(usuario)) {
      // La condición es la MEMBRESÍA en ESTE negocio: una persona que es
      // administradora (o superadmin) de OTRA barbería no puede convertirse
      // en barbero aquí, y `Usuario.rol` no concede ningún privilegio.
      throw new ConflictException(
        'El usuario no es administrador de esta barbería',
      );
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
  async actualizarComision(
    usuarioId: number,
    dto: ActualizarComisionDto,
    usuarioAutenticado: any,
  ) {
    const usuario =
      await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (!this.perfilBarberoEnNegocio(usuario)) {
      throw new ConflictException('El usuario no es un barbero');
    }

    const usuarioActual =
      await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException(
        'El usuario autenticado no existe en la base de datos',
      );
    }
    this.authorizationService.verificarPermisosComision(
      construirActorSesion(usuarioAutenticado),
      usuario,
    );
    return this.barberosRepository.actualizarComision(
      usuarioId,
      dto.porcentajeComision,
    );
  }

  /**
   * Obtiene la lista de barberos para el catálogo público.
   * Filtra barberos inactivos y oculta datos sensibles (comisión, email).
   *
   * El `id` devuelto es el `Barbero.id` (NO el `Usuario.id`): es la clave que
   * consumen la disponibilidad y la reserva, de modo que el cliente puede
   * encadenar catálogo â†’ disponibilidad â†’ reserva sin traducir identificadores.
   */
  async obtenerBarberosCatalogo(
    filtro?: FiltroBarberosDto,
  ): Promise<BarberoCatalogoDto[]> {
    const barberos =
      await this.barberosRepository.obtenerBarberosCatalogo(filtro);

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
   *
   * `id` es el `Usuario.id` (identidad global de la persona: es la clave que
   * consume la gestión de usuarios y el estado de la cuenta). `barberoId` es
   * el `Barbero.id`, la clave del perfil de barbero dentro de la barbería: es
   * la que consumen la asignación de servicios a barberos y la disponibilidad.
   */
  async obtenerBarberosGestion(
    filtro?: FiltroBarberosDto,
  ): Promise<BarberoGestionDto[]> {
    const barberos =
      await this.barberosRepository.obtenerBarberosGestion(filtro);

    return barberos.map((barbero) => {
      // El carácter SUPERADMIN es de la MEMBRESÍA del negocio: un barbero es
      // SUPERADMIN de esta barbería si su perfil de administrador aquí lo es.
      const perfilAdmin = this.perfilAdministradorEnNegocio(
        barbero.usuario,
      ) as { estado?: string; superadmin?: boolean } | null;

      return {
        id: barbero.usuario.id,
        barberoId: barbero.id,
        nombre: barbero.usuario.nombre,
        apellido: barbero.usuario.apellido,
        email: barbero.usuario.email,
        telefono: barbero.telefono,
        porcentajeComision: Number(barbero.porcentajeComision),
        estado: barbero.estado,
        fotoUrl: barbero.fotoUrl,
        esAdministrador: Boolean(
          perfilAdmin && perfilAdmin.estado === 'ACTIVO',
        ),
        esSuperAdmin: perfilAdmin?.superadmin === true,
        estadoAdmin: perfilAdmin?.estado,
        // El rol global ya no distingue administrador de barbero: los roles
        // efectivos se derivan de los perfiles del negocio.
        estadoGlobal: barbero.usuario.estado,
      };
    });
  }

  /**
   * Sube y actualiza la foto de perfil de un barbero.
   * Si ya tenía una foto previa en /uploads, la elimina para evitar acumular archivos huérfanos.
   */
  async subirFotoBarbero(
    usuarioId: number,
    archivo: Express.Multer.File,
    usuarioAutenticado?: any,
  ) {
    if (!archivo) {
      throw new ConflictException(
        'No se ha proporcionado ningún archivo de imagen',
      );
    }

    const barbero =
      await this.barberosRepository.obtenerBarberoPorUsuarioId(usuarioId);
    if (!barbero) {
      this.eliminarArchivoSilencioso(archivo.path);
      throw new ConflictException(
        'El usuario no cuenta con un perfil de barbero registrado',
      );
    }

    if (usuarioAutenticado) {
      await this.verificarPermisoSubidaFoto(
        usuarioId,
        archivo,
        usuarioAutenticado,
      );
    }

    // Si ya tenía una foto previa en /uploads, la eliminamos del disco
    if (barbero.fotoUrl?.startsWith('/uploads/')) {
      this.eliminarFotoAnterior(barbero.fotoUrl);
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

  private eliminarArchivoSilencioso(ruta: string): void {
    try {
      fs.unlinkSync(ruta);
    } catch {}
  }

  private async verificarPermisoSubidaFoto(
    usuarioId: number,
    archivo: Express.Multer.File,
    usuarioAutenticado: any,
  ): Promise<void> {
    const usuarioObjetivo =
      await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);
    const usuarioActual =
      await this.buscarUsuarioAutenticado(usuarioAutenticado);
    if (!usuarioActual || !usuarioObjetivo) {
      return;
    }

    try {
      this.authorizationService.verificarPermisosEdicion(
        construirActorSesion(usuarioAutenticado),
        usuarioObjetivo,
      );
    } catch (error) {
      this.eliminarArchivoSilencioso(archivo.path);
      throw error;
    }
  }

  private eliminarFotoAnterior(fotoUrl: string): void {
    const rutaAnterior = join(process.cwd(), fotoUrl);
    if (!fs.existsSync(rutaAnterior)) {
      return;
    }

    try {
      fs.unlinkSync(rutaAnterior);
    } catch (e) {
      console.warn('No se pudo eliminar la foto anterior:', e);
    }
  }

  /**
   * Elimina la foto de perfil del barbero y borra el archivo físico.
   */
  async eliminarFotoBarbero(usuarioId: number) {
    const barbero =
      await this.barberosRepository.obtenerBarberoPorUsuarioId(usuarioId);
    if (!barbero) {
      throw new ConflictException(
        'El usuario no cuenta con un perfil de barbero',
      );
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
   * Si se inactiva, se oculta del catálogo público,
   * pero su cuenta global sigue funcionando si tiene otros roles.
   */
  async cambiarEstadoBarbero(
    usuarioId: number,
    dto: CambiarEstadoUsuarioDto,
    usuarioAutenticado: any,
  ) {
    const usuario =
      await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (!this.perfilBarberoEnNegocio(usuario)) {
      throw new ConflictException('El usuario no es un barbero');
    }

    const usuarioActual =
      await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException(
        'El usuario autenticado no existe en la base de datos',
      );
    }

    this.authorizationService.verificarPermisosCambioEstadoBarbero(
      construirActorSesion(usuarioAutenticado),
      usuario,
    );

    const nuevoEstado = dto.estado;
    const activo = nuevoEstado === EstadoUsuario.ACTIVO;

    if (!activo) {
      // El carácter SUPERADMIN es de la MEMBRESÍA de este negocio, no del
      // `Usuario.rol` global.
      const perfilAdmin = this.perfilAdministradorEnNegocio(usuario) as {
        estado?: string;
        superadmin?: boolean;
      } | null;
      const esAdminActivo = perfilAdmin?.estado === EstadoUsuario.ACTIVO;
      const esSuperAdmin = perfilAdmin?.superadmin === true;
      if (!esSuperAdmin && !esAdminActivo) {
        await this.usuariosRepository.actualizarEstadoUsuario(
          usuarioId,
          EstadoUsuario.INACTIVO,
        );
      }
    }

    return this.barberosRepository.actualizarEstadoBarbero(
      usuarioId,
      nuevoEstado,
    );
  }
}

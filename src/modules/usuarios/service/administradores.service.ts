import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { AdministradoresRepository } from '../repository/administradores.repository';
import { CrearAdministradorDto } from '../dto/dto-peticion/crear-administrador.dto';
import { FiltroAdministradoresDto } from '../dto/dto-peticion/filtro-administradores.dto';
import { AdministradorResponseDto } from '../dto/dto-respuesta/administrador-response.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';

@Injectable()
export class AdministradoresService {
  private readonly logger = new Logger(AdministradoresService.name);

  constructor(
    private readonly administradoresRepository: AdministradoresRepository,
    private readonly usuariosRepository: UsuariosRepository,
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  /**
   * Perfil de ADMINISTRADOR de la persona en el NEGOCIO ACTIVO.
   *
   * Una persona puede ser administradora de varias barberías: el perfil que
   * cuenta es SIEMPRE el de la barbería de la petición. Las relaciones
   * cargadas por Prisma no las filtra la extensión de aislamiento, de modo que
   * el filtro se aplica aquí de forma explícita.
   */
  private perfilAdministradorEnNegocio(usuario: any) {
    const negocioId = this.aislamiento.negocioIdRequerido();

    return (
      (usuario?.administradores ?? []).find(
        (perfil: any) => perfil.negocioId === negocioId,
      ) ?? null
    );
  }

  /** Perfil de BARBERO de la persona en el NEGOCIO ACTIVO. */
  private perfilBarberoEnNegocio(usuario: any) {
    const negocioId = this.aislamiento.negocioIdRequerido();

    return (
      (usuario?.barberos ?? []).find(
        (perfil: any) => perfil.negocioId === negocioId,
      ) ?? null
    );
  }

  /**
   * Registra a un nuevo administrador/gerente en el sistema.
   * Crea el usuario en MySQL con rol ADMINISTRADOR y genera su perfil en MySQL.
   * Exclusivo para el SUPERADMIN.
   */
  async crearAdministrador(dto: CrearAdministradorDto) {
    const usuarioExistente =
      await this.usuariosRepository.obtenerUsuarioPorEmail(dto.email);
    if (usuarioExistente) {
      throw new ConflictException(
        'Ya existe un usuario en el sistema con este correo electrónico.',
      );
    }

    try {
      const administrador = await this.prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.create({
          data: {
            email: dto.email,
            nombre: dto.nombre,
            apellido: dto.apellido ?? '',
            // El rol global ya no distingue administrador de barbero: los
            // roles efectivos se derivan del perfil del negocio.
            rol: 'PERSONAL',
          },
        });

        return tx.administrador.create({
          data: {
            usuarioId: usuario.id,
            negocioId: this.aislamiento.negocioIdRequerido(),
          },
        });
      });

      // OWASP A09: Registro de transacciones de alto valor
      this.logger.log(
        `AUDIT: Nuevo Administrador creado en el sistema. Email: ${dto.email}`,
      );

      return {
        mensaje: 'Administrador creado correctamente',
        administrador,
      };
    } catch (error) {
      this.logger.error(
        'Error guardando administrador en la base de datos:',
        error,
      );
      throw new ConflictException(
        'El administrador no pudo registrarse. Intente nuevamente.',
      );
    }
  }

  /**
   * Obtiene la lista completa de todos los administradores del sistema con soporte de filtros.
   * Exclusivo para la tabla de gestión del SUPERADMIN.
   */
  async obtenerAdministradores(
    filtro?: FiltroAdministradoresDto,
  ): Promise<AdministradorResponseDto[]> {
    const administradores =
      await this.administradoresRepository.obtenerAdministradores(filtro);

    return administradores.map((administrador: any) => ({
      id: administrador.usuario.id,
      nombre: administrador.usuario.nombre,
      apellido: administrador.usuario.apellido,
      email: administrador.usuario.email,
      estado: administrador.usuario.estado, // Estado de la cuenta global
      estadoAdmin: administrador.estado, // Estado del rol de administrador
      esBarbero: (administrador.usuario.barberos ?? []).length > 0,
      estadoBarbero: (administrador.usuario.barberos ?? [])[0]?.estado,
    }));
  }

  /**
   * Cambia el estado del rol de ADMINISTRADOR (ACTIVO/INACTIVO) para un usuario.
   * Si se inactiva, se hace Soft Delete de su perfil.
   * Si es su único rol, se bloquea su cuenta global.
   */
  async cambiarEstadoAdministrador(usuarioId: number, estado: string) {
    const usuario =
      await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (estado === 'ACTIVO') {
      // ALTA: se crea (o reactiva) la membresía de administrador de ESTA
      // barbería. La pertenencia la decide el SUPERADMIN de la barbería
      // (lo exige el endpoint), no el `Usuario.rol` global.
      return this.promoverAdministrador(usuario);
    }

    // BAJA: solo se puede revocar una membresía que exista en ESTA
    // barbería. La pertenencia se decide por la MEMBRESÍA
    // (`Administrador.negocioId`), nunca por el `Usuario.rol` global.
    const perfilAdmin = this.perfilAdministradorEnNegocio(usuario) as {
      estado?: string;
      superadmin?: boolean;
    } | null;

    if (!perfilAdmin) {
      throw new NotFoundException(
        'El usuario no es administrador de esta barbería',
      );
    }

    // El SUPERADMIN DE ESTA BARBERÍA no se degrada con este endpoint (su
    // carácter es de la membresía, no del `Usuario.rol` global).
    if (perfilAdmin.superadmin === true) {
      throw new ConflictException(
        'No se pueden modificar los privilegios del SUPERADMIN de esta barbería',
      );
    }

    return this.revocarAdministrador(usuario);
  }

  /**
   * Promueve al usuario a ADMINISTRADOR: reactiva o crea su perfil de
   * administrador en el negocio activo y conserva el manejo de errores
   * original.
   *
   * El rol GLOBAL ya no se modifica: los roles efectivos se derivan del
   * perfil del negocio, no de `Usuario.rol`.
   */
  private async promoverAdministrador(usuario: any) {
    const perfilAdmin = this.perfilAdministradorEnNegocio(usuario);

    if (perfilAdmin && perfilAdmin.estado === 'ACTIVO') {
      throw new ConflictException(
        'Este usuario ya tiene privilegios de Administrador',
      );
    }

    try {
      const adminExistente =
        await this.administradoresRepository.obtenerAdministradorPorUsuarioId(
          usuario.id,
        );

      const administrador = adminExistente
        ? await this.administradoresRepository.actualizarEstadoAdministrador(
            usuario.id,
            'ACTIVO',
          )
        : await this.administradoresRepository.crearAdministrador({
            usuarioId: usuario.id,
          });

      return {
        mensaje: 'Usuario promovido a Administrador exitosamente',
        administrador,
      };
    } catch (error) {
      this.logger.error(
        'Error promoviendo al administrador en la base de datos:',
        error,
      );
      throw new ConflictException(
        'No se pudo promover al usuario en la base de datos local',
      );
    }
  }

  /**
   * Revoca los privilegios de ADMINISTRADOR: desactiva su perfil de
   * administrador del negocio activo y bloquea la cuenta global si no conserva
   * otro rol activo.
   *
   * El rol GLOBAL no se modifica: los roles efectivos se derivan del perfil
   * del negocio.
   */
  private async revocarAdministrador(usuario: any) {
    if (!this.perfilAdministradorEnNegocio(usuario)) {
      throw new ConflictException(
        'Este usuario no tiene privilegios de Administrador',
      );
    }

    try {
      await this.administradoresRepository.actualizarEstadoAdministrador(
        usuario.id,
        'INACTIVO',
      );

      const esBarberoActivo =
        this.perfilBarberoEnNegocio(usuario)?.estado === 'ACTIVO';
      if (!esBarberoActivo) {
        await this.usuariosRepository.actualizarEstadoUsuario(
          usuario.id,
          'INACTIVO',
        );
      }

      return {
        mensaje:
          'Se han revocado los privilegios de Administrador exitosamente',
      };
    } catch (error) {
      this.logger.error(
        'Error degradando al administrador en la base de datos:',
        error,
      );
      throw new ConflictException(
        'No se pudo degradar al usuario en la base de datos local',
      );
    }
  }
}

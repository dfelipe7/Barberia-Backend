import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';

import { BarberosRepository } from '../repository/barberos.repository';
import { AdministradoresRepository } from '../repository/administradores.repository';
import { ActualizarUsuarioDto } from '../dto/dto-peticion/actualizar-usuario.dto';
import {
  CambiarEstadoUsuarioGestionDto,
  TipoMembresiaEstado,
} from '../dto/dto-peticion/cambiar-estado-usuario-gestion.dto';
import { UsuarioPerfilDto } from '../dto/dto-respuesta/usuario-perfil.dto';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { AdministradoresService } from './administradores.service';
import { BarberosService } from './barberos.service';
import {
  ActorSesion,
  construirActorSesion,
} from '../../../auth/sesion/sesion-personal';
import {
  ROL_ADMINISTRADOR,
  ROL_BARBERO,
  ROL_SUPERADMIN,
} from '../../negocios/negocios.constants';

import { ClaimsSesionPersonal } from '../../../auth/sesion/sesion-personal';
import { Prisma } from '../../../../generated/prisma/client';

export type UsuarioPerfilAdministrador = {
  id: number;
  negocioId: number;
  estado: string;
  superadmin: boolean;
};

export type UsuarioPerfilBarbero = {
  id: number;
  negocioId: number;
  telefono: string;
  porcentajeComision: Prisma.Decimal | number | string;
  fotoUrl: string | null;
  estado: string;
};

export type UsuarioConPerfiles = {
  id: number;
  email: string | null;
  nombre: string;
  apellido: string;
  rol: string;
  estado: string;
  administrador?: UsuarioPerfilAdministrador | null;
  barbero?: UsuarioPerfilBarbero | null;
  administradores?: UsuarioPerfilAdministrador[];
  barberos?: UsuarioPerfilBarbero[];
};

export type UsuarioNormalizado = UsuarioConPerfiles;

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    private readonly usuariosRepository: UsuariosRepository,
    private readonly barberosRepository: BarberosRepository,
    private readonly administradoresRepository: AdministradoresRepository,
    private readonly authorizationService: UsuariosAuthorizationService,
    @Inject(forwardRef(() => AdministradoresService))
    private readonly administradoresService: AdministradoresService,
    @Inject(forwardRef(() => BarberosService))
    private readonly barberosService: BarberosService,
  ) {}

  /**
   * Actor de la petición: la SESIÓN (identidad global + roles efectivos en el
   * negocio). Es lo que se usa para autorizar; el registro de `Usuario` solo
   * se usa para saber que la identidad existe.
   */
  private actorDe(
    usuarioAutenticado?: Partial<ClaimsSesionPersonal>,
  ): ActorSesion {
    return construirActorSesion(usuarioAutenticado);
  }

  private async buscarUsuarioAutenticado(
    usuarioAutenticado?: Partial<ClaimsSesionPersonal>,
  ) {
    if (usuarioAutenticado?.email) {
      const u = await this.usuariosRepository.obtenerUsuarioPorEmail(
        usuarioAutenticado.email,
      );
      if (u) return u;
    }
    if (usuarioAutenticado?.id) {
      const u = await this.usuariosRepository.obtenerUsuarioPorId(
        Number(usuarioAutenticado.id),
      );
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
  async obtenerMiPerfil(
    usuarioAutenticado?: Partial<ClaimsSesionPersonal>,
  ): Promise<UsuarioPerfilDto> {
    const usuarioActual =
      await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException(
        'El usuario autenticado no existe en la base de datos',
      );
    }

    const actor = this.actorDe(usuarioAutenticado);
    const usuarioNormalizado = this.normalizarPerfilesNegocio(
      usuarioActual,
      actor.negocioId,
    );

    return this.mapearUsuarioPerfil(usuarioNormalizado);
  }

  /**
   * Obtiene los datos de un usuario específico por su ID numérico.
   * Valida que el usuario que realiza la petición tenga permisos para verlo.
   */
  async obtenerUsuarioPorId(
    usuarioId: number,
    usuarioAutenticado?: Partial<ClaimsSesionPersonal>,
  ): Promise<UsuarioPerfilDto> {
    const usuario =
      await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const usuarioActual =
      await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException(
        'El usuario autenticado no existe en la base de datos',
      );
    }

    const actor = this.actorDe(usuarioAutenticado);

    // Multitenant: Normalizamos los perfiles (administrador y barbero) del usuario
    // objetivo para el negocio activo del actor antes de validar permisos y mapear el DTO.
    // Esto garantiza que usuario.administrador y usuario.barbero no sean undefined.
    const usuarioNormalizado = this.normalizarPerfilesNegocio(
      usuario,
      actor.negocioId,
    );

    this.authorizationService.verificarPermisosConsulta(
      actor,
      usuarioNormalizado,
    );

    return this.mapearUsuarioPerfil(usuarioNormalizado);
  }

  /**
   * Actualiza el nombre, apellido y correo de un usuario.
   * Refleja los cambios en la base de datos local.
   * Si el usuario es un barbero y se envían datos extra, actualiza el perfil de barbero.
   */
  async actualizarUsuario(
    usuarioId: number,
    dto: ActualizarUsuarioDto,
    usuarioAutenticado?: Partial<ClaimsSesionPersonal>,
  ): Promise<UsuarioNormalizado> {
    const usuario =
      await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const usuarioActual =
      await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException(
        'El usuario autenticado no existe en la base de datos',
      );
    }

    const actor = this.actorDe(usuarioAutenticado);

    // Multitenant: Normalizamos los perfiles del usuario objetivo respecto al negocio
    // activo del actor. De esta forma, verificarPermisosEdicion y los métodos
    // de gestión de roles encontrarán usuario.administrador y usuario.barbero del negocio
    // en vez de undefined, previniendo el error 403 Forbidden.
    const usuarioNormalizado = this.normalizarPerfilesNegocio(
      usuario,
      actor.negocioId,
    );

    this.authorizationService.verificarPermisosEdicion(
      actor,
      usuarioNormalizado,
    );

    await this.actualizarDatosPersonales(usuarioId, dto);
    await this.gestionarRolAdministrador(
      usuarioId,
      dto,
      usuarioNormalizado,
      actor,
    );
    await this.gestionarRolBarbero(
      usuarioId,
      dto,
      usuarioNormalizado,
      actor,
      usuarioAutenticado,
    );

    const usuarioGuardado =
      await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);
    return this.normalizarPerfilesNegocio(usuarioGuardado, actor.negocioId);
  }

  /**
   * 1. Actualiza los datos personales del usuario en MySQL (solo si se enviaron).
   */
  private async actualizarDatosPersonales(
    usuarioId: number,
    dto: ActualizarUsuarioDto,
  ): Promise<void> {
    if (dto.nombre || dto.apellido) {
      await this.usuariosRepository.actualizarUsuario(usuarioId, {
        nombre: dto.nombre,
        apellido: dto.apellido,
      });
    }
  }

  /**
   * 2. Otorga o revoca el rol de Administrador. Conserva el orden de las
   * validaciones de autorización y sus excepciones.
   */
  private async gestionarRolAdministrador(
    usuarioId: number,
    dto: ActualizarUsuarioDto,
    usuario: UsuarioNormalizado,
    actor: ActorSesion,
  ): Promise<void> {
    if (dto.esAdministrador === undefined) {
      return;
    }

    const estadoAdminActual = this.esAdminActivoEnNegocio(
      usuario,
      actor.negocioId,
    );
    if (dto.esAdministrador === estadoAdminActual) {
      return;
    }

    // Otorgar o revocar el rol de ADMINISTRADOR es una decisión del
    // SUPERADMIN **de este negocio**: el poder del superadmin se agota en su
    // barbería y no existe ninguna identidad de plataforma.
    if (!actor.roles.includes('SUPERADMIN')) {
      throw new ForbiddenException(
        'Solo el Superadministrador de esta barbería puede otorgar o revocar el rol de Administrador',
      );
    }
    if (actor.id === usuario.id && !dto.esAdministrador) {
      throw new ConflictException(
        'No puedes remover tu propio rol de Administrador',
      );
    }
    await this.administradoresService.cambiarEstadoAdministrador(
      usuarioId,
      dto.esAdministrador ? 'ACTIVO' : 'INACTIVO',
    );
  }

  /**
   * 3. Gestiona el rol de Barbero: si cambia el estado respecto al actual
   * delega en `cambiarEstadoRolBarbero`; si no, actualiza su perfil.
   */
  private async gestionarRolBarbero(
    usuarioId: number,
    dto: ActualizarUsuarioDto,
    usuario: UsuarioNormalizado,
    actor: ActorSesion,
    usuarioAutenticado?: Partial<ClaimsSesionPersonal>,
  ): Promise<void> {
    const estadoBarberoActual = this.esBarberoActivoEnNegocio(
      usuario,
      actor.negocioId,
    );
    const requiereCambioEstado =
      dto.esBarbero !== undefined && dto.esBarbero !== estadoBarberoActual;

    if (requiereCambioEstado) {
      await this.cambiarEstadoRolBarbero(
        usuarioId,
        dto,
        usuario,
        actor,
        usuarioAutenticado,
      );
      return;
    }

    await this.actualizarPerfilBarberoSiAplica(usuarioId, dto, usuario, actor);
  }

  private async cambiarEstadoRolBarbero(
    usuarioId: number,
    dto: ActualizarUsuarioDto,
    usuario: UsuarioNormalizado,
    actor: ActorSesion,
    usuarioAutenticado?: Partial<ClaimsSesionPersonal>,
  ): Promise<void> {
    if (
      actor.roles.includes(ROL_BARBERO) &&
      !actor.roles.includes(ROL_ADMINISTRADOR) &&
      !actor.roles.includes(ROL_SUPERADMIN)
    ) {
      throw new ForbiddenException(
        'Un barbero no puede modificar ni revocar su propio rol de Barbero',
      );
    }
    this.authorizationService.verificarPermisosCambioEstadoBarbero(
      actor,
      usuario,
    );

    if (dto.esBarbero) {
      await this.barberosService.configurarBarberoPorId(usuarioId, {
        telefono: dto.telefono || usuario.barbero?.telefono || '',
        porcentajeComision:
          dto.porcentajeComision ??
          (usuario.barbero?.porcentajeComision
            ? Number(usuario.barbero.porcentajeComision)
            : 50),
      });
      return;
    }

    await this.barberosService.cambiarEstadoBarbero(
      usuarioId,
      { estado: EstadoUsuario.INACTIVO },
      usuarioAutenticado,
    );
  }

  private async actualizarPerfilBarberoSiAplica(
    usuarioId: number,
    dto: ActualizarUsuarioDto,
    usuario: UsuarioNormalizado,
    actor: ActorSesion,
  ): Promise<void> {
    const enviaDatosPerfil =
      dto.telefono ||
      dto.porcentajeComision !== undefined ||
      dto.fotoUrl !== undefined;

    if (!usuario.barbero || !enviaDatosPerfil) {
      return;
    }

    if (dto.porcentajeComision !== undefined) {
      this.authorizationService.verificarPermisosComision(actor, usuario);
    }

    await this.barberosRepository.actualizarPerfilBarbero(usuarioId, {
      telefono: dto.telefono,
      porcentajeComision: dto.porcentajeComision,
      fotoUrl: dto.fotoUrl,
    });
  }

  /**
   * El objetivo tiene un perfil de administrador ACTIVO en ese negocio.
   * Multitenant: Evalúa tanto el perfil normalizado en singular como el arreglo administradores[].
   */
  private esAdminActivoEnNegocio(
    usuario: UsuarioNormalizado | null | undefined,
    negocioId: number | null,
  ): boolean {
    if (negocioId === null || !usuario) return false;

    // 1. Perfil singular normalizado
    if (
      usuario.administrador &&
      usuario.administrador.negocioId === negocioId &&
      usuario.administrador.estado === 'ACTIVO'
    ) {
      return true;
    }

    // 2. Multitenant (1:N): Arreglo administradores[] de Prisma
    if (Array.isArray(usuario.administradores)) {
      return usuario.administradores.some(
        (a) => a.negocioId === negocioId && a.estado === 'ACTIVO',
      );
    }

    return false;
  }

  /**
   * El objetivo tiene un perfil de barbero ACTIVO en ese negocio.
   * Multitenant: Evalúa tanto el perfil normalizado en singular como el arreglo barberos[].
   */
  private esBarberoActivoEnNegocio(
    usuario: UsuarioNormalizado | null | undefined,
    negocioId: number | null,
  ): boolean {
    if (negocioId === null || !usuario) return false;

    // 1. Perfil singular normalizado
    if (
      usuario.barbero &&
      usuario.barbero.negocioId === negocioId &&
      usuario.barbero.estado === 'ACTIVO'
    ) {
      return true;
    }

    // 2. Multitenant (1:N): Arreglo barberos[] de Prisma
    if (Array.isArray(usuario.barberos)) {
      return usuario.barberos.some(
        (b) => b.negocioId === negocioId && b.estado === 'ACTIVO',
      );
    }

    return false;
  }

  /**
   * Cambia el estado de una membresía del usuario en la barbería actual.
   * No modifica el estado global de la cuenta, de modo que la persona no
   * pierde el acceso a sus demás barberías.
   */
  async cambiarEstadoUsuario(
    usuarioId: number,
    dto: CambiarEstadoUsuarioGestionDto,
    usuarioAutenticado?: Partial<ClaimsSesionPersonal>,
  ): Promise<UsuarioPerfilDto> {
    const usuario =
      await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    const usuarioActual =
      await this.buscarUsuarioAutenticado(usuarioAutenticado);

    if (!usuarioActual) {
      throw new ConflictException(
        'El usuario autenticado no existe en la base de datos',
      );
    }

    const actor = this.actorDe(usuarioAutenticado);

    const usuarioNormalizado = this.normalizarPerfilesNegocio(
      usuario,
      actor.negocioId,
    ) as Parameters<
      UsuariosAuthorizationService['verificarPermisosCambioEstadoCuenta']
    >[1];

    this.authorizationService.verificarPermisosCambioEstadoCuenta(
      actor,
      usuarioNormalizado,
    );

    const quiereAdministrador =
      dto.tipo === TipoMembresiaEstado.ADMINISTRADOR ||
      dto.tipo === TipoMembresiaEstado.AMBOS;
    const quiereBarbero =
      dto.tipo === TipoMembresiaEstado.BARBERO ||
      dto.tipo === TipoMembresiaEstado.AMBOS;

    if (quiereAdministrador && !usuarioNormalizado.administrador) {
      throw new ConflictException(
        'El usuario no es administrador de esta barbería',
      );
    }

    if (quiereBarbero && !usuarioNormalizado.barbero) {
      throw new ConflictException('El usuario no es barbero de esta barbería');
    }

    if (quiereAdministrador) {
      await this.administradoresRepository.actualizarEstadoAdministrador(
        usuarioId,
        dto.estado,
      );
    }

    if (quiereBarbero) {
      await this.barberosRepository.actualizarEstadoBarbero(
        usuarioId,
        dto.estado,
      );
    }

    const usuarioGuardado =
      await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);
    return this.mapearUsuarioPerfil(
      this.normalizarPerfilesNegocio(usuarioGuardado, actor.negocioId),
    );
  }

  /**
   * Transforma el objeto de usuario proveniente de Prisma al DTO UsuarioPerfilDto.
   * Garantiza la conversión del Decimal de porcentajeComision a number para TypeScript y Swagger.
   */
  /**
   * Normaliza los perfiles de administrador y barbero de un usuario para que
   * correspondan al negocio evaluado (por defecto, el del actor).
   */
  private normalizarPerfilesNegocio(
    usuario: UsuarioConPerfiles | null | undefined,
    negocioId: number | null,
  ): UsuarioNormalizado {
    if (!usuario) return {} as UsuarioNormalizado;
    // comprobado arriba

    let administrador = usuario.administrador;
    if (
      administrador === undefined &&
      Array.isArray(usuario.administradores) &&
      negocioId !== null
    ) {
      administrador =
        usuario.administradores.find(
          (a: UsuarioPerfilAdministrador) => a.negocioId === negocioId,
        ) ?? null;
    }

    let barbero = usuario.barbero;
    if (
      barbero === undefined &&
      Array.isArray(usuario.barberos) &&
      negocioId !== null
    ) {
      barbero =
        usuario.barberos.find(
          (b: UsuarioPerfilBarbero) => b.negocioId === negocioId,
        ) ?? null;
    }

    return {
      ...usuario,
      administrador,
      barbero,
    };
  }

  private mapearUsuarioPerfil(usuario: UsuarioNormalizado): UsuarioPerfilDto {
    return {
      id: usuario.id,
      email: usuario.email ?? '',
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      rol: usuario.rol,
      estado: usuario.estado,
      administrador: usuario.administrador
        ? {
            id: usuario.administrador.id,
            estado: usuario.administrador.estado,
            superadmin: usuario.administrador.superadmin === true,
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

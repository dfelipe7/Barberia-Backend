import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NegocioRolesService } from '../../modules/negocios/service/negocio-roles.service';
import { ROL_SUPERADMIN } from '../../modules/negocios/negocios.constants';
import { NegociosRepository } from '../../modules/negocios/repository/negocios.repository';
import { NegocioContextoService } from '../../modules/negocios/negocio-contexto.service';
import { PersonalJwtService } from './personal-jwt.service';
import {
  ClaimsSesionPersonal,
  SesionPersonal,
  TIPO_TOKEN_PERSONAL,
} from './sesion-personal';

/**
 * Emisión de las sesiones de personal: la que nace al iniciar sesión, la que
 * se renueva y la que se obtiene al cambiar de negocio de forma explícita.
 *
 * SEPARACIÓN DE CONTEXTOS
 * ----------------------
 * - Sesión OPERATIVA (`ambito: NEGOCIO`): lleva `negocioId` y los roles
 *   EFECTIVOS de la persona en ese negocio. Es la única que autoriza las
 *   rutas de negocio (reservas, clientes, servicios, horarios, usuarios).
 * - Sesión GLOBAL DE PLATAFORMA (`ambito: PLATAFORMA`): no lleva `negocioId`.
 *   Solo autoriza las rutas de plataforma, que son explícitas. Un token
 *   global NO habilita por sí solo las rutas normales de negocio.
 *
 * Los roles de una sesión operativa NUNCA se derivan del campo global
 * `Usuario.rol` (`ADMINISTRADOR` / `BARBERO`): se derivan de los PERFILES
 * operativos (`Administrador` / `Barbero`) de la persona en ese negocio. La
 * única excepción es `SUPERADMIN`, que es una identidad global de plataforma
 * por diseño y queda acotada al negocio de la sesión.
 */
@Injectable()
export class SesionPersonalService {
  private readonly logger = new Logger(SesionPersonalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly personalJwt: PersonalJwtService,
    private readonly rolesService: NegocioRolesService,
    private readonly negociosRepository: NegociosRepository,
    private readonly contextoService: NegocioContextoService,
  ) {}

  /**
   * Emite una sesión operativa para un negocio concreto.
   *
   * @param usuario Identidad global (`Usuario`).
   * @param negocio Negocio al que queda vinculada la sesión.
   * @param roles Roles efectivos de la persona en ese negocio.
   * @param fotoUrl Foto de la sesión (perfil de barbero del negocio o Google).
   */
  emitirParaNegocio(
    usuario: UsuarioSesion,
    negocio: { id: number; slug: string },
    roles: string[],
    fotoUrl: string | null,
  ): RespuestaSesion {
    const rolesEfectivos = this.completarRoles(usuario, roles);

    const claims: Omit<ClaimsSesionPersonal, 'tipo'> = {
      sub: String(usuario.id),
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      rol: usuario.rol,
      roles: rolesEfectivos,
      superadmin: usuario.rol === ROL_SUPERADMIN,
      ambito: 'NEGOCIO',
      negocioId: negocio.id,
      negocioSlug: negocio.slug,
      estado: usuario.estado,
      fotoUrl,
    };

    const accessToken = this.personalJwt.firmar(claims);

    return {
      accessToken,
      usuario: this.mapearUsuario(usuario, rolesEfectivos, fotoUrl),
      negocio: { id: negocio.id, slug: negocio.slug },
    };
  }

  /**
   * Emite una sesión global de plataforma (identidad `SUPERADMIN`).
   *
   * No lleva `negocioId`: por diseño NO autoriza las rutas de negocio. Para
   * operar dentro de una barbería hay que hacer la transición explícita
   * (`POST /auth/tenant/:slug`), que queda acotada al negocio de destino.
   */
  emitirParaPlataforma(
    usuario: UsuarioSesion,
    fotoUrl: string | null,
  ): RespuestaSesion {
    const claims: Omit<ClaimsSesionPersonal, 'tipo'> = {
      sub: String(usuario.id),
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      rol: usuario.rol,
      roles: [ROL_SUPERADMIN],
      superadmin: true,
      ambito: 'PLATAFORMA',
      estado: usuario.estado,
      fotoUrl,
    };

    const accessToken = this.personalJwt.firmar(claims);

    return {
      accessToken,
      usuario: this.mapearUsuario(usuario, [ROL_SUPERADMIN], fotoUrl),
      negocio: null,
    };
  }

  /**
   * Renueva una sesión conservando su ámbito.
   *
   * - Sesión operativa: se vuelve a validar el negocio (sigue activo) y la
   *   pertenencia de la persona; los roles se RECALCULAN contra la base de
   *   datos, de modo que revocar un perfil surte efecto en la renovación.
   * - Sesión de plataforma: se mantiene global, pero solo si la identidad
   *   sigue siendo de plataforma y está activa.
   */
  async renovar(
    sesion: SesionPersonal,
    usuario: UsuarioSesion,
  ): Promise<RespuestaSesion> {
    if (usuario.estado !== 'ACTIVO') {
      throw new ForbiddenException(
        'Tu cuenta ha sido desactivada por un administrador',
      );
    }

    if (sesion.ambito === 'PLATAFORMA' || !sesion.negocioId) {
      if (!sesion.superadmin || usuario.rol !== ROL_SUPERADMIN) {
        throw new ForbiddenException('La sesión ya no es válida');
      }

      return this.emitirParaPlataforma(usuario, sesion.fotoUrl);
    }

    const negocio = await this.negociosRepository.buscarActivoPorSlug(
      sesion.negocioSlug ?? '',
    );

    if (!negocio || negocio.id !== sesion.negocioId) {
      throw new ForbiddenException(
        'El negocio de la sesión ya no está disponible',
      );
    }

    const perfil = await this.rolesService.perfilOperativo(usuario.id, negocio);

    const roles = this.completarRoles(usuario, perfil.roles);

    if (roles.length === 0) {
      throw new ForbiddenException(
        'Ya no tienes roles activos en este negocio',
      );
    }

    return this.emitirParaNegocio(
      usuario,
      negocio,
      roles,
      perfil.fotoUrl ?? sesion.fotoUrl,
    );
  }

  /**
   * CAMBIO EXPLÍCITO DE NEGOCIO.
   *
   * El destino se resuelve SIEMPRE desde el slug de la ruta, mediante el
   * repositorio de negocios (que solo devuelve negocios ACTIVOS). El contexto
   * de negocio de la petición NO interviene: así el middleware ordinario no
   * puede dirigir la transición a un negocio distinto del solicitado.
   *
   * Para el personal se exige un perfil operativo ACTIVO en el negocio de
   * destino y se recalculan los roles allí (no se heredan del token previo).
   *
   * Para `SUPERADMIN` la transición es un acceso PRIVILEGIADO: queda acotado
   * al negocio de destino y se registra en el log de auditoría del proyecto.
   */
  async cambiarNegocio(
    sesion: SesionPersonal,
    slug: string,
  ): Promise<RespuestaSesion> {
    const negocio = await this.negociosRepository.buscarActivoPorSlug(slug);

    if (!negocio) {
      throw new ForbiddenException('El negocio solicitado no está disponible');
    }

    const usuario = await this.cargarUsuario(sesion.id);

    if (!usuario || usuario.estado !== 'ACTIVO') {
      throw new ForbiddenException('La sesión ya no es válida');
    }

    const perfil = await this.rolesService.perfilOperativo(usuario.id, negocio);

    const roles = this.completarRoles(usuario, perfil.roles);

    if (roles.length === 0) {
      throw new ForbiddenException(
        'No tienes ningún perfil activo en el negocio solicitado',
      );
    }

    if (sesion.superadmin) {
      this.auditarAccesoPrivilegiado(
        usuario.id,
        negocio,
        'cambio explícito de negocio',
      );
    }

    return this.emitirParaNegocio(usuario, negocio, roles, perfil.fotoUrl);
  }

  /**
   * Identidad global (`Usuario`) de la persona de la sesión.
   *
   * Se relee de la base de datos: una sesión no puede RENOVAR a una
   * identidad que ya no existe o que está desactivada.
   */
  async cargarUsuario(usuarioId: number): Promise<UsuarioSesion | null> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        id: true,
        email: true,
        nombre: true,
        apellido: true,
        rol: true,
        estado: true,
      },
    });

    return usuario ?? null;
  }

  /**
   * Registra en el log de auditoría el acceso privilegiado de un
   * `SUPERADMIN` a un negocio concreto.
   *
   * Se usa el mecanismo de auditoría YA existente en el proyecto (el logger
   * con el prefijo `AUDIT:`), no se inventa infraestructura nueva.
   */
  auditarAccesoPrivilegiado(
    usuarioId: number,
    negocio: { id: number; slug: string },
    motivo: string,
  ): void {
    this.logger.log(
      `AUDIT: acceso de plataforma al negocio ${negocio.slug} (id=${negocio.id}) por el usuario ${usuarioId}. Motivo: ${motivo}`,
    );
  }

  /** Contexto de negocio de la petición, si lo hay. */
  contextoActual(): { id: number; slug: string } | null {
    return this.contextoService.obtenerContexto() ?? null;
  }

  /**
   * Completa los roles de una sesión con la identidad global de plataforma.
   *
   * `SUPERADMIN` es la ÚNICA identidad que conserva significado global: se
   * mantiene dentro del negocio de la sesión, nunca por encima de ella.
   */
  private completarRoles(usuario: UsuarioSesion, roles: string[]): string[] {
    if (usuario.rol === ROL_SUPERADMIN && !roles.includes(ROL_SUPERADMIN)) {
      return [...roles, ROL_SUPERADMIN];
    }

    return roles;
  }

  private mapearUsuario(
    usuario: UsuarioSesion,
    roles: string[],
    fotoUrl: string | null,
  ): UsuarioRespuesta {
    return {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      /** Valor global heredado de `Usuario.rol`. Informativo. */
      rol: usuario.rol,
      /** Roles efectivos de la sesión. */
      roles,
      estado: usuario.estado,
      fotoUrl,
    };
  }
}

/** Datos de la identidad global (`Usuario`) que viajan en la sesión. */
export interface UsuarioSesion {
  id: number;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  estado: string;
}

/** Parte del usuario que se devuelve en la respuesta de sesión. */
export interface UsuarioRespuesta {
  id: number;
  email: string;
  nombre: string;
  apellido: string;
  /** Valor global heredado de `Usuario.rol`. Informativo. */
  rol: string;
  /** Roles efectivos de la sesión. */
  roles: string[];
  estado: string;
  fotoUrl: string | null;
}

/** Respuesta de sesión de personal (login, refresco y cambio de negocio). */
export interface RespuestaSesion {
  accessToken: string;
  usuario: UsuarioRespuesta;
  /** Negocio al que queda vinculada la sesión. `null` en sesión de plataforma. */
  negocio: { id: number; slug: string } | null;
}

export { TIPO_TOKEN_PERSONAL };

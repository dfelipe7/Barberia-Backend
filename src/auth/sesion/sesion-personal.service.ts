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
} from './sesion-personal';

/**
 * Emisión de las sesiones de personal: la que nace al iniciar sesión, la que
 * renueva y la que se obtiene al cambiar de negocio de forma explícita.
 *
 * SEPARACIÓN DE CONTEXTOS
 * ----------------------
 * - Sesión OPERATIVA (`ambito: NEGOCIO`): lleva `negocioId` y los roles
 *   EFECTIVOS de la persona en ese negocio (derivados de sus membresías
 *   activas). Es la ÚNICA clase de sesión de personal que existe.
 *
 * Los roles de una sesión operativa NUNCA se derivan del campo global
 * `Usuario.rol`: se derivan de las MEMBRESÍAS (`Administrador` / `Barbero`)
 * de la persona en ese negocio. El carácter SUPERADMIN es de la membresía
 * (`Administrador.superadmin`) y su alcance es ese negocio.
 *
 * NO existe identidad de plataforma ni sesión de plataforma: en este SaaS
 * todo el personal opera dentro de una barbería concreta.
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
    const claims: Omit<ClaimsSesionPersonal, 'tipo'> = {
      sub: String(usuario.id),
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      rol: usuario.rol,
      roles,
      // Derivado de los roles efectivos de ESTE negocio: nunca del `rol`
      // global de la persona.
      superadmin: roles.includes(ROL_SUPERADMIN),
      ambito: 'NEGOCIO',
      negocioId: negocio.id,
      negocioSlug: negocio.slug,
      estado: usuario.estado,
      fotoUrl,
    };

    const accessToken = this.personalJwt.firmar(claims);

    return {
      accessToken,
      usuario: this.mapearUsuario(usuario, roles, fotoUrl),
      negocio: { id: negocio.id, slug: negocio.slug },
    };
  }

  /**
   * Renueva una sesión conservando su ámbito (siempre un negocio).
   *
   * - El negocio se revalida (sigue activo) y la pertenencia de la persona.
   * - Los roles se RECALCULAN contra la base de datos, de modo que revocar un
   *   perfil surte efecto en la renovación.
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

    if (!sesion.negocioId) {
      throw new ForbiddenException('La sesión ya no es válida');
    }

    const negocio = await this.negociosRepository.buscarActivoPorSlug(
      sesion.negocioSlug ?? '',
    );

    if (negocio?.id !== sesion.negocioId) {
      throw new ForbiddenException(
        'El negocio de la sesión ya no está disponible',
      );
    }

    const perfil = await this.rolesService.perfilOperativo(usuario.id, negocio);

    const roles = perfil.roles;

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
   * Se exige un perfil operativo ACTIVO en el negocio de destino, PARA
   * TODAS LAS PERSONAS: el rol SUPERADMIN de una barbería NO habilita el
   * cambio a otra. En este SaaS no existe ninguna transición privilegiada.
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

    if (usuario?.estado !== 'ACTIVO') {
      throw new ForbiddenException('La sesión ya no es válida');
    }

    const perfil = await this.rolesService.perfilOperativo(usuario.id, negocio);

    const roles = perfil.roles;

    if (roles.length === 0) {
      throw new ForbiddenException(
        'No tienes ningún perfil activo en el negocio solicitado',
      );
    }

    this.auditarCambioNegocio(usuario.id, negocio);

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
   * Registra en el log de auditoría el cambio de negocio de una persona.
   *
   * Se usa el mecanismo de auditoría YA existente en el proyecto (el logger
   * con el prefijo `AUDIT:`), no se inventa infraestructura nueva.
   *
   * Ya no existe el acceso PRIVILEGIADO (no hay identidad de plataforma): el
   * cambio siempre parte de una membresía en el destino, y se audita
   * igualmente por ser un cambio de ámbito de la sesión.
   */
  auditarCambioNegocio(
    usuarioId: number,
    negocio: { id: number; slug: string },
  ): void {
    this.logger.log(
      `AUDIT: cambio de negocio al '${negocio.slug}' (id=${negocio.id}) por el usuario ${usuarioId}.`,
    );
  }

  /** Contexto de negocio de la petición, si lo hay. */
  contextoActual(): { id: number; slug: string } | null {
    return this.contextoService.obtenerContexto() ?? null;
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
  /** Negocio al que queda vinculada la sesión. */
  negocio: { id: number; slug: string } | null;
}

export { TIPO_TOKEN_PERSONAL } from './sesion-personal';

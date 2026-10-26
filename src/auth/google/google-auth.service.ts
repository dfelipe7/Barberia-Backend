import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleTokenVerifier } from './google-token-verifier.service';
import { SesionPersonalService } from '../sesion/sesion-personal.service';
import { NegocioRolesService } from '../../modules/negocios/service/negocio-roles.service';
import { NegocioContextoService } from '../../modules/negocios/negocio-contexto.service';

/**
 * Inicio de sesión del PERSONAL (barbería) con Google OAuth 2.0.
 *
 * IDENTIDAD GLOBAL, ROLES POR NEGOCIO
 * -----------------------------------
 * La identidad es GLOBAL (`Usuario`): la misma persona en toda la plataforma.
 * Lo que cambia por barbería son los ROLES EFECTIVOS, que se derivan de los
 * perfiles operativos (`Administrador` / `Barbero`) de esa persona EN EL
 * NEGOCIO DE LA PETICIÓN. El campo global `Usuario.rol` heredado no autoriza
 * nada.
 *
 * DOS TIPOS DE SESIÓN
 * -------------------
 * - Personal con perfil en una barbería: la sesión queda VINCULADA a ese
 *   negocio (`negocioId`). Sin contexto de negocio o sin perfil activo, el
 *   acceso se rechaza.
 *
 * NO EXISTE SESIÓN DE PLATAFORMA: el SUPERADMIN es un rol de NEGOCIO (la
 * membresía `Administrador.superadmin`), no una identidad global. Toda
 * sesión de personal lleva su negocio, y sus roles efectivos se derivan de
 * las membresías de ESE negocio. Para operar en otra barbería hace falta
 * una membresía activa allí: el cambio de negocio (`POST /auth/tenant/:slug`)
 * no es una transición privilegiada.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleTokenVerifier: GoogleTokenVerifier,
    private readonly sesionService: SesionPersonalService,
    private readonly rolesService: NegocioRolesService,
    private readonly contextoService: NegocioContextoService,
  ) {}

  /**
   * Valida el token emitido por Google OAuth 2.0 y genera la sesión.
   * Si el usuario no existe en la base de datos, rechaza el acceso (Sistema cerrado).
   */
  async loginConGoogle(idToken: string) {
    const payload = await this.googleTokenVerifier.verificar(idToken);

    if (!payload?.email) {
      throw new UnauthorizedException(
        'No se pudo obtener el correo de la cuenta de Google.',
      );
    }

    const email = payload.email.toLowerCase().trim();
    const usuario = await this.prisma.usuario.findUnique({
      where: { email },
    });

    if (!usuario) {
      this.logger.warn(
        `Acceso rechazado: ${email} intentó iniciar sesión pero no está registrado.`,
      );
      throw new UnauthorizedException(
        'No tienes acceso a la plataforma. Tu correo no está registrado en el personal de la barbería.',
      );
    }

    if (usuario.estado === 'INACTIVO') {
      this.logger.warn(`Acceso denegado: ${email} tiene su cuenta suspendida.`);
      throw new ForbiddenException(
        'Tu cuenta ha sido desactivada por un administrador.',
      );
    }

    // Vincular googleId si es la primera vez que inicia sesión con Google
    if (!usuario.googleId && payload.sub) {
      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { googleId: payload.sub },
      });
    }

    const sesion = await this.emitirSesion(usuario, payload.picture);

    this.logger.log(
      `LOGIN EXITOSO: ${usuario.nombre} (${usuario.email}) - Roles: ${sesion.usuario.roles.join(', ')} - Negocio: ${sesion.negocio?.slug ?? 'PLATAFORMA'}`,
    );

    return sesion;
  }

  /**
   * Emite la sesión según la identidad y la pertenencia de la persona.
   *
   * TODA sesión es operativa y está ligada a UNA barbería: no existe sesión
   * de plataforma. Los roles efectivos salen de las membresías activas de la
   * persona en el negocio del contexto; `Usuario.rol` no concede nada.
   */
  private async emitirSesion(
    usuario: {
      id: number;
      email: string;
      nombre: string;
      apellido: string;
      rol: string;
      estado: string;
    },
    fotoUrlGoogle?: string | null,
  ) {
    const contexto = this.contextoService.obtenerContexto();

    if (!contexto) {
      throw new ForbiddenException(
        'No se pudo determinar la barbería de la sesión. Accede desde el dominio de tu barbería.',
      );
    }

    const perfil = await this.rolesService.perfilOperativo(
      usuario.id,
      contexto,
    );

    if (perfil.roles.length === 0) {
      this.logger.warn(
        `Acceso denegado: ${usuario.email} no tiene un perfil activo en ${contexto.slug}.`,
      );
      throw new ForbiddenException(
        'Tu cuenta no tiene ningún perfil activo en esta barbería.',
      );
    }

    return this.sesionService.emitirParaNegocio(
      usuario,
      contexto,
      perfil.roles,
      perfil.fotoUrl ?? fotoUrlGoogle ?? null,
    );
  }
}

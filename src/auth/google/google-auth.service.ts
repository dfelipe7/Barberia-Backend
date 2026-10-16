import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleTokenVerifier } from './google-token-verifier.service';

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly googleTokenVerifier: GoogleTokenVerifier,
  ) {}

  /**
   * Valida el token emitido por Google OAuth 2.0 y genera la sesión en la Barbería.
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
      include: {
        administrador: true,
        barbero: true,
      },
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

    const sesion = this.construirSesion(usuario, payload.picture);

    this.logger.log(
      `LOGIN EXITOSO: ${usuario.nombre} (${usuario.email}) - Roles: ${sesion.usuario.roles.join(', ')}`,
    );

    return sesion;
  }

  /**
   * Revalida los roles vigentes en la base de datos y emite un nuevo JWT actualizado
   * sin requerir que el usuario cierre sesión.
   */
  async refrescarSesion(usuarioId: number, fotoUrlActual?: string | null) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      include: {
        administrador: true,
        barbero: true,
      },
    });

    if (!usuario) {
      throw new UnauthorizedException('El usuario no existe en la base de datos.');
    }

    if (usuario.estado === 'INACTIVO') {
      throw new ForbiddenException('Tu cuenta ha sido desactivada por un administrador.');
    }

    const sesion = this.construirSesion(usuario, fotoUrlActual);

    this.logger.debug(
      `TOKEN RENOVADO: ${usuario.nombre} (${usuario.email}) - Roles: ${sesion.usuario.roles.join(', ')}`,
    );

    return sesion;
  }

  private construirSesion(usuario: any, fotoUrlGoogle?: string | null) {
    const esSuperAdmin = usuario.rol === 'SUPERADMIN';
    const esAdminActivo = usuario.administrador?.estado === 'ACTIVO';
    const esBarberoActivo = usuario.barbero?.estado === 'ACTIVO';

    if (!esSuperAdmin && !esAdminActivo && !esBarberoActivo) {
      this.logger.warn(`Acceso denegado: ${usuario.email} no tiene roles activos.`);
      throw new ForbiddenException(
        'Tu cuenta no tiene ningún rol activo asignado.',
      );
    }

    // Resolver todos los roles activos del usuario
    const roles: string[] = [];
    if (esSuperAdmin) {
      roles.push('SUPERADMIN');
    }
    if (esAdminActivo || (usuario.rol === 'ADMINISTRADOR' && !usuario.administrador)) {
      if (!roles.includes('ADMINISTRADOR')) {
        roles.push('ADMINISTRADOR');
      }
    }
    if (esBarberoActivo || (usuario.rol === 'BARBERO' && !usuario.barbero)) {
      if (!roles.includes('BARBERO')) {
        roles.push('BARBERO');
      }
    }

    // Prioridad de foto:
    // 1. Foto personalizada de barbero en la base de datos
    // 2. Foto de la cuenta de Google
    // 3. null (iniciales)
    const fotoUrl = usuario.barbero?.fotoUrl || fotoUrlGoogle || null;

    // Generar el JWT oficial de la Barbería con sus roles y reclamos
    const tokenPayload = {
      sub: String(usuario.id),
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      rol: usuario.rol,
      roles,
      estado: usuario.estado,
      fotoUrl,
    };

    const accessToken = this.jwtService.sign(tokenPayload);

    return {
      accessToken,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        rol: usuario.rol,
        roles,
        estado: usuario.estado,
        fotoUrl,
      },
    };
  }
}

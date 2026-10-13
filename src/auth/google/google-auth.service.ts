import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly oauthClient: OAuth2Client;
  private readonly googleClientId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {
    this.googleClientId = this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID');
    this.oauthClient = new OAuth2Client(this.googleClientId);
  }

  /**
   * Valida el token emitido por Google OAuth 2.0 y genera la sesión en la Barbería.
   * Si el usuario no existe en la base de datos, rechaza el acceso (Sistema cerrado).
   */
  async loginConGoogle(idToken: string) {
    let payload;
    try {
      const ticket = await this.oauthClient.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });
      payload = ticket.getPayload();
    } catch (error: any) {
      this.logger.warn(`Intento de login con token de Google inválido: ${error?.message}`);
      throw new UnauthorizedException('El token de autenticación de Google es inválido o ha expirado.');
    }

    if (!payload || !payload.email) {
      throw new UnauthorizedException('No se pudo obtener el correo de la cuenta de Google.');
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
      this.logger.warn(`Acceso rechazado: ${email} intentó iniciar sesión pero no está registrado.`);
      throw new UnauthorizedException(
        'No tienes acceso a la plataforma. Tu correo no está registrado en el personal de la barbería.',
      );
    }

    if (usuario.estado === 'INACTIVO') {
      this.logger.warn(`Acceso denegado: ${email} tiene su cuenta suspendida.`);
      throw new ForbiddenException('Tu cuenta ha sido desactivada por un administrador.');
    }

    // Vincular googleId si es la primera vez que inicia sesión con Google
    if (!usuario.googleId && payload.sub) {
      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { googleId: payload.sub },
      });
    }

    // Generar el JWT oficial de la Barbería con sus roles y reclamos
    const tokenPayload = {
      sub: String(usuario.id),
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      rol: usuario.rol,
      roles: [usuario.rol],
      estado: usuario.estado,
      fotoUrl: payload.picture || (usuario.barbero?.fotoUrl ?? null),
    };

    const accessToken = this.jwtService.sign(tokenPayload);

    this.logger.log(`LOGIN EXITOSO: ${usuario.nombre} (${usuario.email}) - Rol: ${usuario.rol}`);

    return {
      accessToken,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        rol: usuario.rol,
        estado: usuario.estado,
        fotoUrl: payload.picture || (usuario.barbero?.fotoUrl ?? null),
      },
    };
  }
}

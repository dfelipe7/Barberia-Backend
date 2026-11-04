import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guardián de seguridad que protege los endpoints de administración global de la plataforma SaaS.
 *
 * @remarks
 * Modelo de Autorización Jerárquica:
 * Los administradores de barbería individual no tienen autorización para listar o alterar
 * otras sedes del ecosistema. Este guard intercepta la solicitud y valida el correo del usuario
 * autenticado contra la lista blanca oficial de administradores de plataforma (`PLATFORM_ADMIN_EMAILS`).
 * Si el correo no forma parte de la lista blanca, arroja `403 Forbidden` inmediatamente.
 */
@Injectable()
export class PlataformaAdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Evalúa si el usuario autenticado cuenta con privilegios de superadministrador de plataforma.
   *
   * @param context - Contexto de ejecución HTTP de NestJS
   * @returns `true` si el correo está explícitamente autorizado en la lista blanca de la plataforma
   * @throws {ForbiddenException} Si el correo no tiene privilegios de superadmin global
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { email?: string };
    }>();

    const allowlist = (
      this.configService.get<string>('PLATFORM_ADMIN_EMAILS') ?? ''
    )
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    const email = request.user?.email?.trim().toLowerCase();

    if (allowlist.length === 0 || !email || !allowlist.includes(email)) {
      throw new ForbiddenException(
        'No tienes permisos de administrador de plataforma',
      );
    }

    return true;
  }
}

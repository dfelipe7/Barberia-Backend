import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/**
 * Guard de Autorización Basado en Roles (RolesGuard)
 *
 * Este guardia actúa DESPUÉS de que el JwtAuthGuard validó el token y
 * comprobó que la sesión pertenece al negocio de la petición.
 *
 * QUÉ ROLES USA
 * -------------
 * Solo `request.user.roles`: los roles EFECTIVOS de la persona en el negocio
 * de la sesión, calculados al emitir el token a partir de sus MEMBRESÍAS
 * activas (`Administrador` / `Barbero`).
 *
 * El campo global `Usuario.rol` NO se usa para autorizar: ese valor no dice
 * en qué barbería se puede operar, y conservarlo como fuente de autoridad
 * sería una vía de elevación de privilegios entre negocios.
 *
 * El carácter SUPERADMIN es de la MEMBRESÍA (`Administrador.superadmin`), de
 * modo que `roles` incluye `SUPERADMIN` únicamente cuando la persona es
 * SUPERADMIN **de ese negocio**. No existe ninguna vía por la que un token
 * obtenga un rol que no le corresponda: el claim `superadmin` del token es un
 * atributo DERIVADO de `roles` y no se usa como fuente de autorización.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { roles?: string[] };
    }>();
    const user = request.user;

    const userRoles = new Set<string>(
      Array.isArray(user?.roles) ? user.roles : [],
    );

    const tieneRol = roles.some((rol) => userRoles.has(rol));

    if (!tieneRol) {
      throw new ForbiddenException(
        'No tienes permisos para realizar esta operación',
      );
    }

    return true;
  }
}

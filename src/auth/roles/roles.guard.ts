import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { ROL_SUPERADMIN } from '../../modules/negocios/negocios.constants';

/**
 * Guard de Autorización Basado en Roles (RolesGuard)
 *
 * Este guardia actúa DESPUÉS de que el JwtAuthGuard validó el token y
 * comprobó que la sesión pertenece al negocio de la petición.
 *
 * QUÉ ROLES USA
 * -------------
 * Solo `request.user.roles`: los roles EFECTIVOS de la persona en el negocio
 * de la sesión, calculados al emitir el token a partir de los perfiles
 * operativos (`Administrador` / `Barbero`).
 *
 * El campo global `Usuario.rol` NO se usa para autorizar: sus valores
 * heredados `ADMINISTRADOR` / `BARBERO` no dicen en qué barbería se puede
 * operar, y conservarlos sería una vía de elevación de privilegios entre
 * negocios. La ÚNICA excepción es `SUPERADMIN`, que es una identidad global
 * de plataforma por diseño: se reconoce por `request.user.superadmin`, y su
 * alcance está limitado por el `negocioId` que el JwtAuthGuard ya cotejó
 * con el contexto de la petición.
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
      user?: { roles?: string[]; superadmin?: boolean };
    }>();
    const user = request.user;

    const userRoles = new Set<string>(
      Array.isArray(user?.roles) ? user.roles : [],
    );

    if (user?.superadmin === true) {
      userRoles.add(ROL_SUPERADMIN);
    }

    const tieneRol = roles.some((rol) => userRoles.has(rol));

    if (!tieneRol) {
      throw new ForbiddenException(
        'No tienes permisos para realizar esta operación',
      );
    }

    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
  ) {}

  canActivate(
    context: ExecutionContext,
  ): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [
        context.getHandler(),
        context.getClass(),
      ],
    );

    if (!roles) {
      return true;
    }

    const request =
      context.switchToHttp().getRequest();

    const user = request.user;

    const userRoles =
      user?.realm_access?.roles ?? [];

    const tieneRol = roles.some(
      (rol) => userRoles.includes(rol),
    );

    if (!tieneRol) {
      throw new ForbiddenException(
        'No tienes permisos para realizar esta operación',
      );
    }

    return true;
  }
}
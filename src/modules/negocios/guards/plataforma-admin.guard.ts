import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ponytail: env allowlist, move to a platform-admin table when this grows
@Injectable()
export class PlataformaAdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

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

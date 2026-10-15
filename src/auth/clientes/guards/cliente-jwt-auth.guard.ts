import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ClienteJwtService } from '../cliente-jwt.service';
import { extraerBearer } from './extraer-bearer';

/**
 * Guard de autenticación OBLIGATORIA de cliente (HE-04-HU-06/HU-07).
 *
 * Exige un token de cliente válido y publica su identidad verificada en
 * `request.cliente`. Rechaza tokens de personal (otro secreto/audiencia/tipo) y
 * cualquier token inválido o expirado con 401.
 */
@Injectable()
export class ClienteJwtAuthGuard implements CanActivate {
  constructor(private readonly clienteJwtService: ClienteJwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = extraerBearer(request.headers?.authorization);

    if (!token) {
      throw new UnauthorizedException('Token de cliente requerido');
    }

    request.cliente = await this.clienteJwtService.verificar(token);
    return true;
  }
}

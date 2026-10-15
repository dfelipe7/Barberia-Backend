import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TIPO_TOKEN_CLIENTE } from '../clientes/cliente-jwt.constants';

/**
 * Guard de Autenticación JWT Oficial (personal de la barbería).
 *
 * Intercepta las solicitudes HTTP entrantes, extrae el Bearer Token
 * y valida su firma criptográfica local usando JwtService.
 *
 * Rechaza explícitamente los tokens de CLIENTE (que se firman con otro secreto
 * y llevan `tipo = CLIENTE`): un token de cliente nunca autoriza rutas de
 * personal, ni siquiera si ambos secretos coincidieran por error de config.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException('Token de autenticación requerido');
    }

    const [type, token] = authorization.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Formato de token inválido');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      if ((payload as { tipo?: unknown })?.tipo === TIPO_TOKEN_CLIENTE) {
        throw new UnauthorizedException(
          'Se requiere un token de personal, no de cliente',
        );
      }
      request.user = payload;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}

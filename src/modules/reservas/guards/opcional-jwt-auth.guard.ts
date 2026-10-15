import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Guard de autenticación OPCIONAL para la creación de reservas.
 *
 * Permite implementar las dos modalidades de D-01 con un único endpoint:
 * - Sin `Authorization` → no autentica; la reserva se trata como invitado
 *   (Modalidad A) y el servicio exige nombre + contacto.
 * - Con `Authorization: Bearer <token>` válido → publica `request.user` con el
 *   payload; la reserva se trata como cliente autenticado (Modalidad B).
 *
 * No emite ni renueva tokens ni modifica la seguridad del personal: reutiliza la
 * misma verificación de firma que `JwtAuthGuard`. Un token presente pero inválido
 * o con formato incorrecto se rechaza (401); NUNCA se degrada silenciosamente a
 * invitado, para no convertir un error de credenciales en una reserva anónima.
 *
 * Limitación conocida (D-01): todavía no existe un flujo de inicio de sesión de
 * clientes. Este guard deja el punto de extensión listo, pero la Modalidad B no
 * es alcanzable hasta que se decida y habilite dicha autenticación.
 */
@Injectable()
export class OpcionalJwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers?.authorization;

    if (!authorization) {
      return true;
    }

    const [type, token] = authorization.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Formato de token inválido');
    }

    try {
      request.user = await this.jwtService.verifyAsync(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}

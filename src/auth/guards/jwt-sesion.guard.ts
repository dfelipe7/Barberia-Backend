import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PersonalJwtService } from '../sesion/personal-jwt.service';
import {
  ClaimsSesionPersonal,
  TIPO_TOKEN_PERSONAL,
} from '../sesion/sesion-personal';

/**
 * Guard de sesión de PERSONAL sin vínculo de negocio.
 *
 * Se usa en las rutas que GESTIONAN la propia sesión (renovación y cambio
 * explícito de negocio). A diferencia de `JwtAuthGuard`:
 *
 * - NO exige que la petición tenga un contexto de negocio: el destino se
 *   resuelve por la ruta, no por el contexto ordinario.
 * - NO exige que el negocio de la sesión coincida con el de la petición: justo
 *   por eso existe el cambio explícito de negocio.
 *
 * Lo que SÍ exige es que el token sea una sesión de personal válida y
 * vigente: nunca se acepta un token de cliente ni uno manipulado.
 */
@Injectable()
export class JwtSesionGuard implements CanActivate {
  constructor(private readonly personalJwt: PersonalJwtService) {}

  /**
   * Valida la autenticidad del token de sesión de personal en rutas de gestión de sesión.
   *
   * @remarks
   * A diferencia de `JwtAuthGuard`, no exige correspondencia con la sede actual porque
   * se utiliza específicamente para refrescar el token o conmutar de sede (`/auth/tenant/:slug`).
   * Valida que el token corresponda al tipo `TIPO_TOKEN_PERSONAL` e inyecta los claims en `request.user`.
   *
   * @param context - Contexto de ejecución de NestJS.
   * @returns Booleano indicando si la petición está autorizada para proceder.
   * @throws {UnauthorizedException} Si el token falta, tiene formato incorrecto, expiró o no es de tipo personal.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: ClaimsSesionPersonal;
    }>();
    const authorization = request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException('Token de autenticación requerido');
    }

    const [type, token] = authorization.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Formato de token inválido');
    }

    let payload: ClaimsSesionPersonal;

    try {
      payload = await this.personalJwt.verificar(token);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (payload.tipo !== TIPO_TOKEN_PERSONAL) {
      throw new UnauthorizedException(
        'El token no corresponde a una sesión de personal',
      );
    }

    request.user = payload;

    return true;
  }
}

import { UnauthorizedException } from '@nestjs/common';

/**
 * Extrae el token de un encabezado `Authorization: Bearer <token>`.
 *
 * - Devuelve `null` si no hay encabezado (para que el guard opcional trate la
 *   petición como invitado).
 * - Lanza `UnauthorizedException` si el encabezado existe pero no es un Bearer
 *   bien formado, para no degradar silenciosamente a invitado.
 */
export function extraerBearer(authorization: unknown): string | null {
  if (typeof authorization !== 'string' || authorization.length === 0) {
    return null;
  }

  const [type, token] = authorization.split(' ');

  if (type !== 'Bearer' || !token) {
    throw new UnauthorizedException('Formato de token inválido');
  }

  return token;
}

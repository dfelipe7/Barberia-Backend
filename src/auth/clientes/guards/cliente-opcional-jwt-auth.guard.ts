import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ClienteJwtService } from '../cliente-jwt.service';
import { extraerBearer } from './extraer-bearer';

/**
 * Guard de autenticación OPCIONAL de cliente, para el `POST /reservas` que
 * admite las dos modalidades (invitado y cliente autenticado):
 *
 * - Sin `Authorization` → no autentica; la reserva se trata como invitado.
 * - Con `Bearer` de cliente válido → publica `request.cliente`; Modalidad B.
 * - Con `Bearer` presente pero inválido, expirado o de personal → 401 (NUNCA se
 *   degrada silenciosamente a invitado).
 */
@Injectable()
export class ClienteOpcionalJwtAuthGuard implements CanActivate {
  constructor(private readonly clienteJwtService: ClienteJwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = extraerBearer(request.headers?.authorization);

    // Sin token: la reserva continúa como invitado. Con token: se verifica la
    // identidad del cliente y, si es inválido, `verificar` lanza 401 (nunca se
    // degrada silenciosamente a invitado). En ambos casos autorizados se
    // permite el paso, por lo que el retorno se expresa una sola vez.
    if (token) {
      request.cliente = await this.clienteJwtService.verificar(token);
    }

    return true;
  }
}

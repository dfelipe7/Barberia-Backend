import { ExecutionContext, Injectable } from '@nestjs/common';
import { ClienteJwtService } from '../cliente-jwt.service';
import { ClienteJwtAuthGuard } from './cliente-jwt-auth.guard';
import { NegocioContextoService } from '../../../modules/negocios/negocio-contexto.service';
import { extraerBearer } from './extraer-bearer';

/**
 * Guard de autenticación OPCIONAL de cliente, para el `POST /reservas` que
 * admite las dos modalidades (invitado y cliente autenticado):
 *
 * - Sin `Authorization` → no autentica; la reserva se trata como invitado.
 * - Con `Bearer` de cliente válido → publica `request.cliente`; Modalidad B.
 * - Con `Bearer` presente pero inválido, expirado, de personal o de otra
 *   barbería → 401/403 (NUNCA se degrada silenciosamente a invitado).
 */
@Injectable()
export class ClienteOpcionalJwtAuthGuard extends ClienteJwtAuthGuard {
  constructor(
    clienteJwtService: ClienteJwtService,
    contextoService: NegocioContextoService,
  ) {
    super(clienteJwtService, contextoService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
    }>();

    // Sin token: la reserva continúa como invitado. Con token: se verifica la
    // identidad del cliente y, si es inválido, `verificar` lanza 401 (nunca se
    // degrada silenciosamente a invitado). En ambos casos autorizados se
    // permite el paso, por lo que el retorno se expresa una sola vez.
    if (!extraerBearer(request.headers?.authorization)) {
      return true;
    }

    return super.canActivate(context);
  }
}

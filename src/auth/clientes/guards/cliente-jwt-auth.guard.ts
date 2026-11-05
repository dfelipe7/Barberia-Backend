import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ClienteJwtService, ClienteAutenticado } from '../cliente-jwt.service';
import { extraerBearer } from './extraer-bearer';
import { NegocioContextoService, ContextoNegocio } from '../../../modules/negocios/negocio-contexto.service';


/**
 * Guard de autenticación OBLIGATORIA de cliente (HE-04-HU-06/HU-07).
 *
 * Exige un token de cliente válido y publica su identidad verificada en
 * `request.cliente`. Rechaza tokens de personal (otro secreto/audiencia/tipo) y
 * cualquier token inválido o expirado con 401.
 *
 * VÍNCULO CON LA BARBERÍA: la sesión del cliente queda atada al negocio en el
 * que se inició sesión. Un token de cliente de una barbería no sirve en otra:
 * el `negocioId` del token se compara con el contexto de negocio RESUELTO por
 * el servidor, nunca con algo que envíe el cliente.
 */
@Injectable()
export class ClienteJwtAuthGuard implements CanActivate {
  constructor(
    protected readonly clienteJwtService: ClienteJwtService,
    protected readonly contextoService: NegocioContextoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      cliente?: ClienteAutenticado;
    }>();
    const token = extraerBearer(request.headers?.authorization);

    if (!token) {
      throw new UnauthorizedException('Token de cliente requerido');
    }

    const cliente = await this.clienteJwtService.verificar(token);

    exigirNegocioCoincidente(cliente, this.contextoService.obtenerContexto());

    request.cliente = cliente;
    return true;
  }
}

/**
 * Comprueba que la sesión de cliente pertenece al negocio de la petición.
 *
 * @throws UnauthorizedException si la sesión no está vinculada a ninguna
 * barbería (token emitido antes de esta fase).
 * @throws ForbiddenException si la petición no tiene contexto de barbería o
 * si la sesión pertenece a otra.
 */
export function exigirNegocioCoincidente(
  cliente: ClienteAutenticado,
  contexto: ContextoNegocio | undefined,
): void {
  if (!contexto) {
    throw new ForbiddenException(
      'La petición no tiene un contexto de barbería autorizado',
    );
  }

  if (cliente.negocioId === null) {
    throw new UnauthorizedException(
      'La sesión de cliente no está vinculada a una barbería: inicia sesión de nuevo',
    );
  }

  if (cliente.negocioId !== contexto.id) {
    throw new ForbiddenException(
      'Tu sesión pertenece a otra barbería: no puede operar en esta',
    );
  }
}

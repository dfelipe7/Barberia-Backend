import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ClienteOpcionalJwtAuthGuard } from './cliente-opcional-jwt-auth.guard';
import { ClienteJwtService } from '../cliente-jwt.service';
import { NegocioContextoService } from '../../../modules/negocios/negocio-contexto.service';

describe('ClienteOpcionalJwtAuthGuard', () => {
  let guard: ClienteOpcionalJwtAuthGuard;

  const clienteJwtService = { verificar: jest.fn() };
  const contextoService = {
    obtenerContexto: jest.fn().mockReturnValue({ id: 10, slug: 'kyrios' }),
  };

  const crearContexto = (headers: Record<string, string> = {}) => {
    const request: {
      headers: Record<string, string>;
      cliente?: unknown;
    } = { headers };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    contextoService.obtenerContexto.mockReturnValue({
      id: 10,
      slug: 'kyrios',
    });
    guard = new ClienteOpcionalJwtAuthGuard(
      clienteJwtService as unknown as ClienteJwtService,
      contextoService as unknown as NegocioContextoService,
    );
  });

  it('permite el paso sin token (invitado) sin identificar cliente', async () => {
    const { context, request } = crearContexto();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.cliente).toBeUndefined();
    expect(clienteJwtService.verificar).not.toHaveBeenCalled();
  });

  it('rechaza un formato de token inválido', async () => {
    const { context } = crearContexto({ authorization: 'Basic abc' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('no degrada a invitado si el token de cliente es inválido', async () => {
    const { context } = crearContexto({ authorization: 'Bearer roto' });
    clienteJwtService.verificar.mockRejectedValue(
      new UnauthorizedException('inválido'),
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('publica la identidad del cliente con un token válido', async () => {
    const { context, request } = crearContexto({
      authorization: 'Bearer token-cliente',
    });
    clienteJwtService.verificar.mockResolvedValue({
      clienteId: 7,
      negocioId: 10,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.cliente).toEqual({ clienteId: 7, negocioId: 10 });
  });
});

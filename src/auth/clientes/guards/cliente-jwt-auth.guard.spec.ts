import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ClienteJwtAuthGuard } from './cliente-jwt-auth.guard';
import { ClienteJwtService } from '../cliente-jwt.service';
import { NegocioContextoService } from '../../../modules/negocios/negocio-contexto.service';

describe('ClienteJwtAuthGuard', () => {
  let guard: ClienteJwtAuthGuard;

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
    guard = new ClienteJwtAuthGuard(
      clienteJwtService as unknown as ClienteJwtService,
      contextoService as unknown as NegocioContextoService,
    );
  });

  it('rechaza (401) si no hay token', async () => {
    const { context } = crearContexto();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(clienteJwtService.verificar).not.toHaveBeenCalled();
  });

  it('rechaza un formato de token inválido', async () => {
    const { context } = crearContexto({ authorization: 'Token abc' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('publica la identidad verificada en request.cliente', async () => {
    const { context, request } = crearContexto({
      authorization: 'Bearer token-cliente',
    });
    clienteJwtService.verificar.mockResolvedValue({
      clienteId: 7,
      email: 'ana@gmail.com',
      nombre: 'Ana',
      negocioId: 10,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(clienteJwtService.verificar).toHaveBeenCalledWith('token-cliente');
    expect(request.cliente).toEqual({
      clienteId: 7,
      email: 'ana@gmail.com',
      nombre: 'Ana',
      negocioId: 10,
    });
  });

  it('rechaza (403) una sesión de cliente de OTRA barbería', async () => {
    const { context } = crearContexto({
      authorization: 'Bearer token-cliente',
    });
    clienteJwtService.verificar.mockResolvedValue({
      clienteId: 7,
      email: 'ana@gmail.com',
      nombre: 'Ana',
      negocioId: 20,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('propaga el 401 del verificador (p. ej. token de personal)', async () => {
    const { context } = crearContexto({
      authorization: 'Bearer token-personal',
    });
    clienteJwtService.verificar.mockRejectedValue(
      new UnauthorizedException('no es de cliente'),
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OpcionalJwtAuthGuard } from './opcional-jwt-auth.guard';

describe('OpcionalJwtAuthGuard', () => {
  let guard: OpcionalJwtAuthGuard;

  const jwtService = {
    verifyAsync: jest.fn(),
  };

  const crearContexto = (headers: Record<string, string> = {}) => {
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(() => {
    jwtService.verifyAsync.mockReset();
    guard = new OpcionalJwtAuthGuard(jwtService as unknown as JwtService);
  });

  it('permite el paso sin token (invitado) sin publicar usuario', async () => {
    const { context, request } = crearContexto();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rechaza un formato de token inválido', async () => {
    const { context } = crearContexto({ authorization: 'Token abc' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza un token inválido y no degrada a invitado', async () => {
    const { context } = crearContexto({ authorization: 'Bearer roto' });
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('publica el payload en request.user con un token válido', async () => {
    const { context, request } = crearContexto({
      authorization: 'Bearer valido',
    });
    const payload = { id: 9, rol: 'BARBERO' };
    jwtService.verifyAsync.mockResolvedValue(payload);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(payload);
  });
});

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(() => {
    jwtService = {
      verifyAsync: jest.fn(),
    } as any;
    guard = new JwtAuthGuard(jwtService);
  });

  const createMockContext = (authHeader?: string): ExecutionContext => {
    const request: any = {
      headers: authHeader ? { authorization: authHeader } : {},
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;
  };

  it('debe estar definido', () => {
    expect(guard).toBeDefined();
  });

  it('debe lanzar UnauthorizedException si no hay cabecera Authorization', async () => {
    const context = createMockContext();
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token de autenticación requerido'),
    );
  });

  it('debe lanzar UnauthorizedException si el formato del token no es Bearer', async () => {
    const context = createMockContext('Basic 123456');
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Formato de token inválido'),
    );
  });

  it('debe validar exitosamente un JWT válido y adjuntar request.user', async () => {
    const mockPayload = { id: 1, email: 'test@gmail.com', rol: 'SUPERADMIN' };
    jwtService.verifyAsync.mockResolvedValue(mockPayload);

    const context = createMockContext('Bearer token-valido');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('token-valido');
    const request = context.switchToHttp().getRequest();
    expect(request.user).toEqual(mockPayload);
  });

  it('debe lanzar UnauthorizedException si el token ha expirado o es inválido', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('Token expired'));

    const context = createMockContext('Bearer token-expirado');
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token inválido o expirado'),
    );
  });

  it('debe rechazar un token de CLIENTE aunque su firma sea válida', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      clienteId: 7,
      tipo: 'CLIENTE',
    });

    const context = createMockContext('Bearer token-cliente');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const request = context.switchToHttp().getRequest();
    expect(request.user).toBeUndefined();
  });
});

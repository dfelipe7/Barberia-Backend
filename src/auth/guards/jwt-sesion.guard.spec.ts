import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtSesionGuard } from './jwt-sesion.guard';
import { PersonalJwtService } from '../sesion/personal-jwt.service';
import { TIPO_TOKEN_PERSONAL } from '../sesion/sesion-personal';

describe('JwtSesionGuard', () => {
  let guard: JwtSesionGuard;
  let personalJwt: jest.Mocked<PersonalJwtService>;

  beforeEach(() => {
    personalJwt = {
      verificar: jest.fn(),
    } as any;

    guard = new JwtSesionGuard(personalJwt);
  });

  function mockContext(headers: Record<string, string>): {
    context: ExecutionContext;
    request: any;
  } {
    const request = { headers };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  it('lanza 401 si no hay cabecera authorization', async () => {
    const { context } = mockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token de autenticación requerido'),
    );
  });

  it('lanza 401 si el esquema no es Bearer', async () => {
    const { context } = mockContext({ authorization: 'Basic 123456' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Formato de token inválido'),
    );
  });

  it('lanza 401 si falta el token después de Bearer', async () => {
    const { context } = mockContext({ authorization: 'Bearer ' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Formato de token inválido'),
    );
  });

  it('re-lanza UnauthorizedException si verificar() arroja UnauthorizedException', async () => {
    personalJwt.verificar.mockRejectedValue(
      new UnauthorizedException('Expirado expreso'),
    );
    const { context } = mockContext({ authorization: 'Bearer token-exp' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Expirado expreso',
    );
  });

  it('transforma otros errores de verificar() en UnauthorizedException genérica', async () => {
    personalJwt.verificar.mockRejectedValue(new Error('JWT malformed'));
    const { context } = mockContext({ authorization: 'Bearer malformed' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token inválido o expirado'),
    );
  });

  it('lanza 401 si el tipo de token no es de personal', async () => {
    personalJwt.verificar.mockResolvedValue({
      tipo: 'OTRO_TIPO' as any,
    } as any);
    const { context } = mockContext({ authorization: 'Bearer cliente-token' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException(
        'El token no corresponde a una sesión de personal',
      ),
    );
  });

  it('asigna request.user y retorna true si el token es válido', async () => {
    const validClaims = {
      sub: 'user-1',
      id: 1,
      tipo: TIPO_TOKEN_PERSONAL,
      negocioId: 10,
    } as any;
    personalJwt.verificar.mockResolvedValue(validClaims);

    const { context, request } = mockContext({
      authorization: 'Bearer valid-jwt',
    });
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user).toEqual(validClaims);
  });
});

import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PersonalJwtService } from '../sesion/personal-jwt.service';
import { ClaimsSesionPersonal } from '../sesion/sesion-personal';
import { NegocioContextoService } from '../../modules/negocios/negocio-contexto.service';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let verificar: jest.Mock;
  let obtenerContexto: jest.Mock;

  const sesionNegocio: ClaimsSesionPersonal = {
    sub: '1',
    id: 1,
    email: 'test@gmail.com',
    nombre: 'Test',
    apellido: 'Prueba',
    tipo: 'PERSONAL',
    rol: 'PERSONAL',
    roles: ['BARBERO'],
    superadmin: false,
    ambito: 'NEGOCIO',
    negocioId: 10,
    negocioSlug: 'kyrios-studio',
    estado: 'ACTIVO',
    fotoUrl: null,
  };

  beforeEach(() => {
    verificar = jest.fn();
    obtenerContexto = jest
      .fn()
      .mockReturnValue({ id: 10, slug: 'kyrios-studio' });

    const personalJwt = { verificar } as unknown as PersonalJwtService;
    const contextoService = {
      obtenerContexto,
    } as unknown as NegocioContextoService;

    guard = new JwtAuthGuard(personalJwt, contextoService);
  });

  const createMockContext = (
    authHeader?: string,
  ): { context: ExecutionContext; request: { user?: unknown } } => {
    const request: { headers: { authorization?: string }; user?: unknown } = {
      headers: authHeader ? { authorization: authHeader } : {},
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    return { context, request };
  };

  it('debe estar definido', () => {
    expect(guard).toBeDefined();
  });

  it('debe lanzar UnauthorizedException si no hay cabecera Authorization', async () => {
    const { context } = createMockContext();
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token de autenticación requerido'),
    );
  });

  it('debe lanzar UnauthorizedException si el formato del token no es Bearer', async () => {
    const { context } = createMockContext('Basic 123456');
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Formato de token inválido'),
    );
  });

  it('debe validar exitosamente un JWT válido y adjuntar request.user', async () => {
    verificar.mockResolvedValue(sesionNegocio);

    const { context, request } = createMockContext('Bearer token-valido');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(verificar).toHaveBeenCalledWith('token-valido');
    expect(request.user).toEqual(sesionNegocio);
  });

  it('debe lanzar UnauthorizedException si el token ha expirado o es inválido', async () => {
    verificar.mockRejectedValue(
      new UnauthorizedException('Token inválido o expirado'),
    );

    const { context } = createMockContext('Bearer token-expirado');
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token inválido o expirado'),
    );
  });

  it('debe rechazar un token de CLIENTE aunque su firma sea válida', async () => {
    verificar.mockRejectedValue(
      new UnauthorizedException(
        'El token no corresponde a una sesión de personal',
      ),
    );

    const { context, request } = createMockContext('Bearer token-cliente');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.user).toBeUndefined();
  });

  it('debe rechazar una sesión de PLATAFORMA en las rutas de negocio', async () => {
    verificar.mockResolvedValue({
      ...sesionNegocio,
      ambito: 'PLATAFORMA',
      negocioId: undefined,
      roles: ['SUPERADMIN'],
      superadmin: true,
    });

    const { context } = createMockContext('Bearer token-plataforma');
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException(
        'La sesión no está vinculada a un negocio: inicia sesión de nuevo',
      ),
    );
  });

  it('debe rechazar la sesión si la petición no tiene contexto de negocio', async () => {
    verificar.mockResolvedValue(sesionNegocio);
    obtenerContexto.mockReturnValue(undefined);

    const { context } = createMockContext('Bearer token-valido');
    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException(
        'La petición no tiene un contexto de negocio autorizado',
      ),
    );
  });

  it('debe rechazar la sesión de otro negocio (la cabecera no amplía permisos)', async () => {
    verificar.mockResolvedValue(sesionNegocio);
    obtenerContexto.mockReturnValue({ id: 20, slug: 'otro' });

    const { context } = createMockContext('Bearer token-valido');
    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException(
        'La sesión pertenece a otro negocio: no puede operar en este',
      ),
    );
  });
});

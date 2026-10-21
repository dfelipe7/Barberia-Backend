import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;
    guard = new RolesGuard(reflector);
  });

  const createMockContext = (user?: any): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as any;
  };

  it('debe permitir acceso si la ruta no tiene roles requeridos', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createMockContext({ roles: [] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso si el usuario tiene un rol efectivo coincidente', () => {
    reflector.getAllAndOverride.mockReturnValue([
      'ADMINISTRADOR',
      'SUPERADMIN',
    ]);
    const context = createMockContext({ roles: ['ADMINISTRADOR'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso si el array de roles efectivos incluye el requerido', () => {
    reflector.getAllAndOverride.mockReturnValue(['BARBERO']);
    const context = createMockContext({ roles: ['BARBERO', 'ADMINISTRADOR'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso a un SUPERADMIN de SU negocio (rol efectivo)', () => {
    reflector.getAllAndOverride.mockReturnValue(['SUPERADMIN']);
    const context = createMockContext({
      roles: ['SUPERADMIN'],
      superadmin: true,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('NO debe conceder SUPERADMIN por el booleano global del token', () => {
    // Un token antiguo (o manipulado) con `superadmin: true` pero sin el rol
    // efectivo NO habilita las rutas de SUPERADMIN: el rol se deriva de la
    // membresía, no de un claim.
    reflector.getAllAndOverride.mockReturnValue(['SUPERADMIN']);
    const context = createMockContext({
      roles: ['ADMINISTRADOR'],
      superadmin: true,
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('NO debe autorizar por el rol global heredado (user.rol)', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMINISTRADOR']);
    const context = createMockContext({ rol: 'PERSONAL', roles: [] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('NO debe autorizar por roles ajenos al modelo (realm_access)', () => {
    reflector.getAllAndOverride.mockReturnValue(['SUPERADMIN']);
    const context = createMockContext({
      realm_access: { roles: ['SUPERADMIN'] },
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('debe lanzar ForbiddenException si el usuario no tiene los roles requeridos', () => {
    reflector.getAllAndOverride.mockReturnValue(['SUPERADMIN']);
    const context = createMockContext({ roles: ['BARBERO'] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow(
      'No tienes permisos para realizar esta operación',
    );
  });

  it('debe lanzar ForbiddenException si no hay usuario autenticado en la petición', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMINISTRADOR']);
    const context = createMockContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});

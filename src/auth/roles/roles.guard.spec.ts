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
    const context = createMockContext({ rol: 'CLIENTE' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso si el usuario tiene rol único coincidente (user.rol)', () => {
    reflector.getAllAndOverride.mockReturnValue([
      'ADMINISTRADOR',
      'SUPERADMIN',
    ]);
    const context = createMockContext({ rol: 'ADMINISTRADOR' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso si el usuario tiene un array de roles con coincidencia (user.roles)', () => {
    reflector.getAllAndOverride.mockReturnValue(['BARBERO']);
    const context = createMockContext({ roles: ['BARBERO', 'CLIENTE'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso si el usuario tiene rol principal diferente pero roles incluye el requerido', () => {
    reflector.getAllAndOverride.mockReturnValue(['BARBERO']);
    const context = createMockContext({
      rol: 'ADMINISTRADOR',
      roles: ['ADMINISTRADOR', 'BARBERO'],
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso si el usuario tiene roles en realm_access', () => {
    reflector.getAllAndOverride.mockReturnValue(['SUPERADMIN']);
    const context = createMockContext({
      realm_access: { roles: ['SUPERADMIN'] },
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe lanzar ForbiddenException si el usuario no tiene los roles requeridos', () => {
    reflector.getAllAndOverride.mockReturnValue(['SUPERADMIN']);
    const context = createMockContext({ rol: 'BARBERO' });

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

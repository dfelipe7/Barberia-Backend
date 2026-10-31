import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PlataformaAdminGuard } from './plataforma-admin.guard';

const contexto = (email?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user: { email } }) }),
  }) as ExecutionContext;

describe('PlataformaAdminGuard', () => {
  const crearGuard = (allowlist?: string) =>
    new PlataformaAdminGuard({
      get: () => allowlist,
    } as unknown as ConfigService);

  it('permite un correo de la lista sin importar mayúsculas o espacios', () => {
    const guard = crearGuard(' Admin@Barberia.com , otro@x.com ');

    expect(guard.canActivate(contexto('admin@barberia.com'))).toBe(true);
  });

  it('rechaza si el correo no está en la lista', () => {
    const guard = crearGuard('admin@barberia.com');

    expect(() => guard.canActivate(contexto('otro@x.com'))).toThrow(
      ForbiddenException,
    );
  });

  it('falla cerrado si la lista está vacía', () => {
    const guard = crearGuard('');

    expect(() => guard.canActivate(contexto('admin@barberia.com'))).toThrow(
      ForbiddenException,
    );
  });
});

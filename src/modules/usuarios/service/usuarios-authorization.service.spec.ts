import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';

describe('UsuariosAuthorizationService', () => {
  let service: UsuariosAuthorizationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsuariosAuthorizationService],
    }).compile();

    service = module.get<UsuariosAuthorizationService>(
      UsuariosAuthorizationService,
    );
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('verificarPermisosConsulta', () => {
    it('SUPERADMIN puede ver cualquier perfil', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          { id: 1, rol: 'SUPERADMIN' },
          { id: 2, rol: 'BARBERO', barbero: {} },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR puede ver su propio perfil', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 1, rol: 'ADMINISTRADOR', barbero: null },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR puede ver a un barbero', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 2, rol: 'BARBERO', barbero: { id: 5 } },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede ver a otro ADMINISTRADOR', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 2, rol: 'ADMINISTRADOR', barbero: null },
        ),
      ).toThrow(ForbiddenException);
    });
    it('BARBERO puede ver su propio perfil', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          { id: 3, rol: 'BARBERO' },
          { id: 3, rol: 'BARBERO' },
        ),
      ).not.toThrow();
    });
    it('BARBERO NO puede ver el perfil de otro usuario', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          { id: 3, rol: 'BARBERO' },
          { id: 4, rol: 'BARBERO' },
        ),
      ).toThrow(ForbiddenException);
    });
    it('Rol desconocido lanza ForbiddenException', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          { id: 1, rol: 'CLIENTE' },
          { id: 2, rol: 'BARBERO' },
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('verificarPermisosEdicion', () => {
    it('SUPERADMIN puede editar cualquier perfil', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          { id: 1, rol: 'SUPERADMIN' },
          { id: 2, rol: 'BARBERO' },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede editar a un SUPERADMIN', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 2, rol: 'SUPERADMIN' },
        ),
      ).toThrow('Un administrador no puede editar a un superadmin');
    });
    it('ADMINISTRADOR puede editar su propio perfil', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 1, rol: 'ADMINISTRADOR' },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede editar a otro ADMINISTRADOR activo', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 3, rol: 'ADMINISTRADOR', administrador: { estado: 'ACTIVO' } },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR puede editar a un barbero puro', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 4, rol: 'BARBERO', administrador: null, barbero: { id: 5 } },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede editar a un usuario sin rol de barbero', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 5, rol: 'CLIENTE', administrador: null, barbero: null },
        ),
      ).toThrow(ForbiddenException);
    });
    it('BARBERO puede editar su propio perfil', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          { id: 3, rol: 'BARBERO' },
          { id: 3, rol: 'BARBERO' },
        ),
      ).not.toThrow();
    });
    it('BARBERO NO puede editar el perfil de otra persona', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          { id: 3, rol: 'BARBERO' },
          { id: 4, rol: 'BARBERO' },
        ),
      ).toThrow('Solo puedes editar tu propio perfil');
    });
    it('Rol desconocido lanza ForbiddenException al editar', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          { id: 1, rol: 'CLIENTE' },
          { id: 2, rol: 'BARBERO' },
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('verificarPermisosCambioEstadoCuenta', () => {
    it('Nadie puede cambiar su propio estado de cuenta', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          { id: 1, rol: 'SUPERADMIN' },
          { id: 1, rol: 'SUPERADMIN' },
        ),
      ).toThrow(
        'No puedes cambiar el estado de tu propio usuario (cuenta global)',
      );
    });
    it('SUPERADMIN puede cambiar el estado de cualquier otro usuario', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          { id: 1, rol: 'SUPERADMIN' },
          { id: 2, rol: 'BARBERO', administrador: null, barbero: {} },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede cambiar el estado de un SUPERADMIN', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 2, rol: 'SUPERADMIN', administrador: null, barbero: null },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR NO puede cambiar el estado de otro ADMINISTRADOR activo', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          { id: 1, rol: 'ADMINISTRADOR' },
          {
            id: 2,
            rol: 'ADMINISTRADOR',
            administrador: { estado: 'ACTIVO' },
            barbero: null,
          },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR puede cambiar el estado de un barbero puro', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 3, rol: 'BARBERO', administrador: null, barbero: { id: 5 } },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede cambiar el estado de un usuario sin perfil de barbero', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 3, rol: 'CLIENTE', administrador: null, barbero: null },
        ),
      ).toThrow(ForbiddenException);
    });
    it('Rol desconocido lanza ForbiddenException al cambiar estado de cuenta', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          { id: 1, rol: 'CLIENTE' },
          { id: 2, rol: 'BARBERO' },
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('verificarPermisosCambioEstadoBarbero', () => {
    it('SUPERADMIN puede cambiar el estado del perfil de cualquier barbero', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          { id: 1, rol: 'SUPERADMIN' },
          { id: 2, rol: 'BARBERO' },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede cambiar el perfil de barbero de un SUPERADMIN', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 2, rol: 'SUPERADMIN' },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR puede cambiar su propio perfil de barbero', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 1, rol: 'ADMINISTRADOR', administrador: { estado: 'ACTIVO' } },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede cambiar el perfil de barbero de otro ADMINISTRADOR', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 2, rol: 'ADMINISTRADOR', administrador: { estado: 'ACTIVO' } },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR puede cambiar el estado de un barbero puro', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 2, rol: 'BARBERO', administrador: null },
        ),
      ).not.toThrow();
    });
    it('BARBERO no puede cambiar estado de ningún perfil de barbero', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          { id: 3, rol: 'BARBERO' },
          { id: 4, rol: 'BARBERO' },
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('verificarPermisosComision', () => {
    it('SUPERADMIN puede modificar cualquier comisión', () => {
      expect(() =>
        service.verificarPermisosComision(
          { id: 1, rol: 'SUPERADMIN' },
          { id: 2, rol: 'BARBERO' },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR puede modificar la comisión de un BARBERO', () => {
      expect(() =>
        service.verificarPermisosComision(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 4, rol: 'BARBERO' },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede modificar la comisión de un SUPERADMIN', () => {
      expect(() =>
        service.verificarPermisosComision(
          { id: 1, rol: 'ADMINISTRADOR' },
          { id: 2, rol: 'SUPERADMIN' },
        ),
      ).toThrow(
        'Un administrador no puede modificar la comisión de un superadmin',
      );
    });
    it('BARBERO no puede modificar ninguna comisión', () => {
      expect(() =>
        service.verificarPermisosComision(
          { id: 4, rol: 'BARBERO' },
          { id: 4, rol: 'BARBERO' },
        ),
      ).toThrow('No tienes permisos para modificar la comisión');
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { ActorSesion } from '../../../auth/sesion/sesion-personal';

describe('UsuariosAuthorizationService', () => {
  let service: UsuariosAuthorizationService;

  const NEGOCIO = 10;

  /**
   * Actor de la petición: identidad global + roles EFECTIVOS en el negocio.
   * El campo global `Usuario.rol` ya no autoriza nada.
   */
  const actor = (
    id: number,
    roles: string[],
    negocioId: number | null = NEGOCIO,
    superadmin = false,
  ): ActorSesion => ({ id, roles, superadmin, negocioId });

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
          actor(1, ['SUPERADMIN'], NEGOCIO, true),
          { id: 2, rol: 'PERSONAL', barbero: { negocioId: NEGOCIO } },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR puede ver su propio perfil', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          actor(1, ['ADMINISTRADOR']),
          { id: 1, rol: 'PERSONAL', barbero: null },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR puede ver a un barbero de SU barbería', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          actor(1, ['ADMINISTRADOR']),
          { id: 2, rol: 'PERSONAL', barbero: { id: 5, negocioId: NEGOCIO } },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede ver a un barbero de OTRA barbería', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          actor(1, ['ADMINISTRADOR']),
          { id: 2, rol: 'PERSONAL', barbero: { id: 5, negocioId: 20 } },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR NO puede ver a otro ADMINISTRADOR', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          actor(1, ['ADMINISTRADOR']),
          { id: 2, rol: 'PERSONAL', barbero: null },
        ),
      ).toThrow(ForbiddenException);
    });
    it('BARBERO puede ver su propio perfil', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          actor(3, ['BARBERO']),
          { id: 3, rol: 'PERSONAL' },
        ),
      ).not.toThrow();
    });
    it('BARBERO NO puede ver el perfil de otro usuario', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          actor(3, ['BARBERO']),
          { id: 4, rol: 'PERSONAL' },
        ),
      ).toThrow(ForbiddenException);
    });
    it('Sin roles efectivos lanza ForbiddenException', () => {
      expect(() =>
        service.verificarPermisosConsulta(
          actor(1, []),
          { id: 2, rol: 'PERSONAL' },
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('verificarPermisosEdicion', () => {
    it('SUPERADMIN puede editar cualquier perfil', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          actor(1, ['SUPERADMIN'], NEGOCIO, true),
          { id: 2, rol: 'PERSONAL' },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede editar a un SUPERADMIN', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          actor(1, ['ADMINISTRADOR']),
          { id: 2, rol: 'SUPERADMIN' },
        ),
      ).toThrow('Un administrador no puede editar a un superadmin');
    });
    it('ADMINISTRADOR puede editar su propio perfil', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          actor(1, ['ADMINISTRADOR']),
          { id: 1, rol: 'PERSONAL' },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede editar a otro ADMINISTRADOR activo de su barbería', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          actor(1, ['ADMINISTRADOR']),
          {
            id: 3,
            rol: 'PERSONAL',
            administrador: { estado: 'ACTIVO', negocioId: NEGOCIO },
          },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR puede editar a un barbero puro de su barbería', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          actor(1, ['ADMINISTRADOR']),
          {
            id: 4,
            rol: 'PERSONAL',
            administrador: null,
            barbero: { id: 5, negocioId: NEGOCIO },
          },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede editar a un barbero de OTRA barbería', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          actor(1, ['ADMINISTRADOR']),
          {
            id: 4,
            rol: 'PERSONAL',
            administrador: null,
            barbero: { id: 5, negocioId: 20 },
          },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR NO puede editar a un usuario sin perfil de barbero', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          actor(1, ['ADMINISTRADOR']),
          { id: 5, rol: 'CLIENTE', administrador: null, barbero: null },
        ),
      ).toThrow(ForbiddenException);
    });
    it('BARBERO puede editar su propio perfil', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          actor(3, ['BARBERO']),
          { id: 3, rol: 'PERSONAL' },
        ),
      ).not.toThrow();
    });
    it('BARBERO NO puede editar el perfil de otra persona', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          actor(3, ['BARBERO']),
          { id: 4, rol: 'PERSONAL' },
        ),
      ).toThrow('Solo puedes editar tu propio perfil');
    });
    it('Sin roles efectivos lanza ForbiddenException al editar', () => {
      expect(() =>
        service.verificarPermisosEdicion(
          actor(1, []),
          { id: 2, rol: 'PERSONAL' },
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('verificarPermisosCambioEstadoCuenta', () => {
    it('Nadie puede cambiar su propio estado de cuenta', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          actor(1, ['SUPERADMIN'], NEGOCIO, true),
          { id: 1, rol: 'SUPERADMIN' },
        ),
      ).toThrow(
        'No puedes cambiar el estado de tu propio usuario (cuenta global)',
      );
    });
    it('SUPERADMIN puede cambiar el estado de cualquier otro usuario', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          actor(1, ['SUPERADMIN'], NEGOCIO, true),
          { id: 2, rol: 'PERSONAL', administrador: null, barbero: {} },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede cambiar el estado de un SUPERADMIN', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          actor(1, ['ADMINISTRADOR']),
          { id: 2, rol: 'SUPERADMIN', administrador: null, barbero: null },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR NO puede cambiar el estado de otro ADMINISTRADOR activo', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          actor(1, ['ADMINISTRADOR']),
          {
            id: 2,
            rol: 'PERSONAL',
            administrador: { estado: 'ACTIVO', negocioId: NEGOCIO },
            barbero: null,
          },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR puede cambiar el estado de un barbero puro de su barbería', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          actor(1, ['ADMINISTRADOR']),
          {
            id: 3,
            rol: 'PERSONAL',
            administrador: null,
            barbero: { id: 5, negocioId: NEGOCIO },
          },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede cambiar el estado de un barbero de OTRA barbería', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          actor(1, ['ADMINISTRADOR']),
          {
            id: 3,
            rol: 'PERSONAL',
            administrador: null,
            barbero: { id: 5, negocioId: 20 },
          },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR NO puede cambiar el estado de un usuario sin perfil de barbero', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          actor(1, ['ADMINISTRADOR']),
          { id: 3, rol: 'CLIENTE', administrador: null, barbero: null },
        ),
      ).toThrow(ForbiddenException);
    });
    it('Sin roles efectivos lanza ForbiddenException al cambiar estado de cuenta', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoCuenta(
          actor(1, []),
          { id: 2, rol: 'PERSONAL' },
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('verificarPermisosCambioEstadoBarbero', () => {
    it('SUPERADMIN puede cambiar el estado del perfil de cualquier barbero', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          actor(1, ['SUPERADMIN'], NEGOCIO, true),
          { id: 2, rol: 'PERSONAL' },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede cambiar el perfil de barbero de un SUPERADMIN', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          actor(1, ['ADMINISTRADOR']),
          { id: 2, rol: 'SUPERADMIN' },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR puede cambiar su propio perfil de barbero', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          actor(1, ['ADMINISTRADOR']),
          {
            id: 1,
            rol: 'PERSONAL',
            administrador: { estado: 'ACTIVO', negocioId: NEGOCIO },
          },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede cambiar el perfil de barbero de otro ADMINISTRADOR', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          actor(1, ['ADMINISTRADOR']),
          {
            id: 2,
            rol: 'PERSONAL',
            administrador: { estado: 'ACTIVO', negocioId: NEGOCIO },
          },
        ),
      ).toThrow(ForbiddenException);
    });
    it('ADMINISTRADOR puede cambiar el estado de un barbero puro', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          actor(1, ['ADMINISTRADOR']),
          { id: 2, rol: 'PERSONAL', administrador: null },
        ),
      ).not.toThrow();
    });
    it('BARBERO no puede cambiar estado de ningún perfil de barbero', () => {
      expect(() =>
        service.verificarPermisosCambioEstadoBarbero(
          actor(3, ['BARBERO']),
          { id: 4, rol: 'PERSONAL' },
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('verificarPermisosComision', () => {
    it('SUPERADMIN puede modificar cualquier comisión', () => {
      expect(() =>
        service.verificarPermisosComision(
          actor(1, ['SUPERADMIN'], NEGOCIO, true),
          { id: 2, rol: 'PERSONAL' },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR puede modificar la comisión de un BARBERO', () => {
      expect(() =>
        service.verificarPermisosComision(
          actor(1, ['ADMINISTRADOR']),
          { id: 4, rol: 'PERSONAL' },
        ),
      ).not.toThrow();
    });
    it('ADMINISTRADOR NO puede modificar la comisión de un SUPERADMIN', () => {
      expect(() =>
        service.verificarPermisosComision(
          actor(1, ['ADMINISTRADOR']),
          { id: 2, rol: 'SUPERADMIN' },
        ),
      ).toThrow(
        'Un administrador no puede modificar la comisión de un superadmin',
      );
    });
    it('BARBERO no puede modificar ninguna comisión', () => {
      expect(() =>
        service.verificarPermisosComision(
          actor(4, ['BARBERO']),
          { id: 4, rol: 'PERSONAL' },
        ),
      ).toThrow('No tienes permisos para modificar la comisión');
    });
  });
});

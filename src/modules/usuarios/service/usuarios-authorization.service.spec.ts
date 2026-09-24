import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';

describe('UsuariosAuthorizationService', () => {
  let service: UsuariosAuthorizationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsuariosAuthorizationService],
    }).compile();

    service = module.get<UsuariosAuthorizationService>(UsuariosAuthorizationService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('verificarPermisosEdicion', () => {
    it('Debe lanzar ForbiddenException si un ADMINISTRADOR intenta editar el perfil de un SUPERADMIN', () => {
      const usuarioActual = { id: 1, rol: 'ADMINISTRADOR' };
      const usuarioObjetivo = { id: 2, rol: 'SUPERADMIN' };

      expect(() => {
        service.verificarPermisosEdicion(usuarioActual, usuarioObjetivo);
      }).toThrow(ForbiddenException);
      expect(() => {
        service.verificarPermisosEdicion(usuarioActual, usuarioObjetivo);
      }).toThrow('Un administrador no puede editar a un superadmin');
    });

    it('Debe permitir la edición si el usuario se está editando a sí mismo (Administrador)', () => {
      const usuarioActual = { id: 1, rol: 'ADMINISTRADOR' };
      const usuarioObjetivo = { id: 1, rol: 'ADMINISTRADOR' };

      expect(() => {
        service.verificarPermisosEdicion(usuarioActual, usuarioObjetivo);
      }).not.toThrow();
    });

    it('Debe lanzar ForbiddenException si un ADMINISTRADOR intenta editar a otro ADMINISTRADOR activo', () => {
      const usuarioActual = { id: 1, rol: 'ADMINISTRADOR' };
      const usuarioObjetivo = { id: 3, rol: 'ADMINISTRADOR', administrador: { estado: 'ACTIVO' } };

      expect(() => {
        service.verificarPermisosEdicion(usuarioActual, usuarioObjetivo);
      }).toThrow(ForbiddenException);
    });
  });

  describe('verificarPermisosComision', () => {
    it('Debe lanzar ForbiddenException si un ADMINISTRADOR intenta editar la comisión de un SUPERADMIN', () => {
      const usuarioActual = { id: 1, rol: 'ADMINISTRADOR' };
      const usuarioObjetivo = { id: 2, rol: 'SUPERADMIN' };

      expect(() => {
        service.verificarPermisosComision(usuarioActual, usuarioObjetivo);
      }).toThrow(ForbiddenException);
      expect(() => {
        service.verificarPermisosComision(usuarioActual, usuarioObjetivo);
      }).toThrow('Un administrador no puede modificar la comisión de un superadmin');
    });

    it('Debe permitir a un ADMINISTRADOR editar la comisión de un BARBERO', () => {
      const usuarioActual = { id: 1, rol: 'ADMINISTRADOR' };
      const usuarioObjetivo = { id: 4, rol: 'BARBERO' };

      expect(() => {
        service.verificarPermisosComision(usuarioActual, usuarioObjetivo);
      }).not.toThrow();
    });

    it('Debe lanzar ForbiddenException si un BARBERO intenta editar alguna comisión', () => {
      const usuarioActual = { id: 4, rol: 'BARBERO' };
      const usuarioObjetivo = { id: 4, rol: 'BARBERO' };

      expect(() => {
        service.verificarPermisosComision(usuarioActual, usuarioObjetivo);
      }).toThrow(ForbiddenException);
      expect(() => {
        service.verificarPermisosComision(usuarioActual, usuarioObjetivo);
      }).toThrow('No tienes permisos para modificar la comisión');
    });
  });
});

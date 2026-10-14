import { Test, TestingModule } from '@nestjs/testing';
import { UsuariosService } from './usuarios.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberosRepository } from '../repository/barberos.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { AdministradoresService } from './administradores.service';
import { BarberosService } from './barberos.service';
import { ConflictException } from '@nestjs/common';

describe('UsuariosService', () => {
  let service: UsuariosService;
  let usuariosRepository: jest.Mocked<UsuariosRepository>;
  let authorizationService: jest.Mocked<UsuariosAuthorizationService>;

  beforeEach(async () => {
    const mockUsuariosRepository = {
      obtenerUsuarioPorGoogleId: jest.fn(),
      obtenerUsuarioPorId: jest.fn(),
      obtenerUsuarioPorEmail: jest.fn(),
      crearUsuario: jest.fn(),
      actualizarUsuario: jest.fn(),
      actualizarEstadoUsuario: jest.fn(),
    };

    const mockBarberosRepository = {
      actualizarPerfilBarbero: jest.fn(),
    };

    const mockAuthorizationService = {
      verificarPermisosConsulta: jest.fn(),
      verificarPermisosEdicion: jest.fn(),
      verificarPermisosCambioEstadoBarbero: jest.fn(),
      verificarPermisosComision: jest.fn(),
      verificarPermisosCambioEstadoCuenta: jest.fn(),
    };

    const mockAdministradoresService = {
      cambiarEstadoAdministrador: jest.fn(),
    };

    const mockBarberosService = {
      configurarBarberoPorId: jest.fn(),
      cambiarEstadoBarbero: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsuariosService,
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
        { provide: BarberosRepository, useValue: mockBarberosRepository },
        { provide: UsuariosAuthorizationService, useValue: mockAuthorizationService },
        { provide: AdministradoresService, useValue: mockAdministradoresService },
        { provide: BarberosService, useValue: mockBarberosService },
      ],
    }).compile();

    service = module.get<UsuariosService>(UsuariosService);
    usuariosRepository = module.get(UsuariosRepository);
    authorizationService = module.get(UsuariosAuthorizationService);
  });

  describe('sincronizarSuperadmin', () => {
    it('debe devolver confirmación de superadministradores verificados', async () => {
      const resultados = await service.sincronizarSuperadmin();
      expect(resultados).toHaveLength(1);
      expect(resultados[0].mensaje).toContain('Superadministradores verificados');
    });
  });

  describe('obtenerMiPerfil', () => {
    it('debe devolver el usuario si existe', async () => {
      const mockUser = {
        id: 1,
        nombre: 'Test',
        apellido: 'User',
        email: 'test@barberia.com',
        rol: 'SUPERADMIN',
        estado: 'ACTIVO',
        administrador: null,
        barbero: null,
      };
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockUser as any);

      const result = await service.obtenerMiPerfil({ id: 1, sub: '1' });
      expect(result).toEqual(mockUser);
    });

    it('debe lanzar ConflictException si no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(service.obtenerMiPerfil({ id: 999, sub: '999' })).rejects.toThrow(ConflictException);
    });
  });

  describe('cambiarEstadoUsuario', () => {
    it('debe cambiar el estado en BD exitosamente', async () => {
      const mockTarget = { id: 2 };
      const mockCaller = { id: 1, rol: 'SUPERADMIN' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(mockTarget as any);
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(mockCaller as any);
      usuariosRepository.actualizarEstadoUsuario.mockResolvedValue({} as any);

      await service.cambiarEstadoUsuario(2, { estado: 'INACTIVO' }, { id: 1, sub: '1' });

      expect(authorizationService.verificarPermisosCambioEstadoCuenta).toHaveBeenCalledWith(mockCaller, mockTarget);
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(2, 'INACTIVO');
    });
  });

  describe('actualizarUsuario', () => {
    it('debe actualizar datos personales en BD exitosamente', async () => {
      const mockTarget = { id: 2, rol: 'BARBERO' };
      const mockCaller = { id: 1, rol: 'ADMINISTRADOR' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(mockTarget as any);
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(mockCaller as any);

      await service.actualizarUsuario(2, { nombre: 'Nuevo' }, { id: 1, sub: '1' });

      expect(usuariosRepository.actualizarUsuario).toHaveBeenCalledWith(2, { nombre: 'Nuevo', apellido: undefined, email: undefined });
    });
  });
});


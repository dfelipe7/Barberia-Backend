import { Test, TestingModule } from '@nestjs/testing';
import { BootstrapService } from './bootstrap.service';
import { KeycloakService } from '../auth/keycloak/keycloak.service';
import { UsuariosRepository } from '../modules/usuarios/repository/usuarios.repository';
import { ConflictException } from '@nestjs/common';

const mockKeycloakService = {
  obtenerUsuariosPorRol: jest.fn(),
};

const mockUsuariosRepository = {
  obtenerUsuarioPorKeycloakId: jest.fn(),
  obtenerUsuarioPorEmail: jest.fn(),
  actualizarRol: jest.fn(),
  actualizarEstadoUsuario: jest.fn(),
  crearUsuario: jest.fn(),
};

describe('BootstrapService', () => {
  let service: BootstrapService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BootstrapService,
        { provide: KeycloakService, useValue: mockKeycloakService },
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
      ],
    }).compile();

    service = module.get<BootstrapService>(BootstrapService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should successfully sync superadmin on first try', async () => {
      mockKeycloakService.obtenerUsuariosPorRol.mockResolvedValue([
        { id: '123', email: 'test@test.com', firstName: 'Admin', lastName: 'Test' },
      ]);
      mockUsuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(null);
      mockUsuariosRepository.crearUsuario.mockResolvedValue({});

      await expect(service.onModuleInit()).resolves.not.toThrow();

      expect(mockUsuariosRepository.crearUsuario).toHaveBeenCalledWith({
        keycloakId: '123',
        email: 'test@test.com',
        nombre: 'Admin',
        apellido: 'Test',
        rol: 'SUPERADMIN',
      });
    });

    it('should use empty string when superadmin has no firstName/lastName', async () => {
      mockKeycloakService.obtenerUsuariosPorRol.mockResolvedValue([
        { id: '456', email: 'noname@test.com', firstName: undefined, lastName: undefined },
      ]);
      mockUsuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(null);
      mockUsuariosRepository.crearUsuario.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockUsuariosRepository.crearUsuario).toHaveBeenCalledWith({
        keycloakId: '456',
        email: 'noname@test.com',
        nombre: '',
        apellido: '',
        rol: 'SUPERADMIN',
      });
    });

    it('should skip already-existing superadmin and still complete without error', async () => {
      mockKeycloakService.obtenerUsuariosPorRol.mockResolvedValue([
        { id: '123', email: 'test@test.com', firstName: 'Admin', lastName: 'Test' },
      ]);
      // Already exists in DB
      mockUsuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 1 });

      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect(mockUsuariosRepository.crearUsuario).not.toHaveBeenCalled();
    });

    it('should retry if keycloak is not ready', async () => {
      mockKeycloakService.obtenerUsuariosPorRol
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce([
          { id: '123', email: 'test@test.com', firstName: 'Admin', lastName: 'Test' },
        ]);

      mockUsuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(true);

      await expect((service as any).esperarYSincronizarSuperadmin(3, 10)).resolves.not.toThrow();
      expect(mockKeycloakService.obtenerUsuariosPorRol).toHaveBeenCalledTimes(2);
    });

    it('should log error and throw when all retries are exhausted', async () => {
      const error = new Error('Connection refused');
      mockKeycloakService.obtenerUsuariosPorRol.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect((service as any).esperarYSincronizarSuperadmin(2, 10)).rejects.toThrow('Connection refused');
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Bootstrap] Error definitivo conectando con Keycloak tras varios intentos:',
        'Connection refused',
      );
      consoleSpy.mockRestore();
    });

    it('should throw ConflictException if no superadmin exists in keycloak', async () => {
      mockKeycloakService.obtenerUsuariosPorRol.mockResolvedValue([]);
      await expect((service as any).sincronizarSuperadmin()).rejects.toThrow(ConflictException);
    });

    it('should fallback to asegurarSuperadminsFundadores when Keycloak is unavailable', async () => {
      mockKeycloakService.obtenerUsuariosPorRol.mockRejectedValue(new Error('Connection refused'));
      mockUsuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      mockUsuariosRepository.crearUsuario.mockResolvedValue({});

      await expect(service.onModuleInit()).resolves.not.toThrow();

      expect(mockUsuariosRepository.crearUsuario).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'armeroduvan8@gmail.com',
          rol: 'SUPERADMIN',
        }),
      );
      expect(mockUsuariosRepository.crearUsuario).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'csbalcazar@unicauca.edu.co',
          rol: 'SUPERADMIN',
        }),
      );
      expect(mockUsuariosRepository.crearUsuario).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'javieraceron@unicauca.edu.co',
          rol: 'SUPERADMIN',
        }),
      );
      expect(mockUsuariosRepository.crearUsuario).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'rromero@unicauca.edu.co',
          rol: 'SUPERADMIN',
        }),
      );
    });

    it('should preserve existing user data and not overwrite roles/state when user exists (Option A)', async () => {
      mockKeycloakService.obtenerUsuariosPorRol.mockRejectedValue(new Error('Connection refused'));
      mockUsuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({
        id: 1,
        email: 'armeroduvan8@gmail.com',
        nombre: 'Felipe',
        rol: 'BARBERO',
        estado: 'INACTIVO',
      });

      await expect(service.onModuleInit()).resolves.not.toThrow();

      expect(mockUsuariosRepository.crearUsuario).not.toHaveBeenCalled();
      expect(mockUsuariosRepository.actualizarRol).not.toHaveBeenCalled();
      expect(mockUsuariosRepository.actualizarEstadoUsuario).not.toHaveBeenCalled();
    });
  });
});

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

    it('should retry if keycloak is not ready', async () => {
      mockKeycloakService.obtenerUsuariosPorRol
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce([
          { id: '123', email: 'test@test.com', firstName: 'Admin', lastName: 'Test' },
        ]);
      
      mockUsuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(true); // Already exists

      await expect((service as any).esperarYSincronizarSuperadmin(3, 10)).resolves.not.toThrow();
      expect(mockKeycloakService.obtenerUsuariosPorRol).toHaveBeenCalledTimes(2);
    });

    it('should throw error if keycloak is permanently down', async () => {
      mockKeycloakService.obtenerUsuariosPorRol.mockRejectedValue(new Error('Network error'));
      await expect((service as any).esperarYSincronizarSuperadmin(2, 10)).rejects.toThrow('Network error');
      expect(mockKeycloakService.obtenerUsuariosPorRol).toHaveBeenCalledTimes(2);
    });

    it('should throw ConflictException if no superadmin exists in keycloak', async () => {
      mockKeycloakService.obtenerUsuariosPorRol.mockResolvedValue([]);
      await expect((service as any).sincronizarSuperadmin()).rejects.toThrow(ConflictException);
    });
  });
});

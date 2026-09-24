import { Test, TestingModule } from '@nestjs/testing';
import { AdministradoresService } from './administradores.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { AdministradoresRepository } from '../repository/administradores.repository';
import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { ConflictException } from '@nestjs/common';

describe('AdministradoresService', () => {
  let service: AdministradoresService;
  let usuariosRepository: jest.Mocked<UsuariosRepository>;
  let administradoresRepository: jest.Mocked<AdministradoresRepository>;
  let keycloakService: jest.Mocked<KeycloakService>;

  beforeEach(async () => {
    const mockUsuariosRepository = {
      obtenerUsuarioPorEmail: jest.fn(),
      obtenerUsuarioPorId: jest.fn(),
      crearUsuario: jest.fn(),
      actualizarRol: jest.fn(),
      actualizarEstadoUsuario: jest.fn(),
    };

    const mockAdministradoresRepository = {
      crearAdministrador: jest.fn(),
      obtenerAdministradores: jest.fn(),
      obtenerAdministradorPorUsuarioId: jest.fn(),
      actualizarEstadoAdministrador: jest.fn(),
    };

    const mockKeycloakService = {
      crearUsuario: jest.fn(),
      asignarRol: jest.fn(),
      quitarRol: jest.fn(),
      cambiarEstadoUsuario: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdministradoresService,
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
        { provide: AdministradoresRepository, useValue: mockAdministradoresRepository },
        { provide: KeycloakService, useValue: mockKeycloakService },
      ],
    }).compile();

    service = module.get<AdministradoresService>(AdministradoresService);
    usuariosRepository = module.get(UsuariosRepository);
    administradoresRepository = module.get(AdministradoresRepository);
    keycloakService = module.get(KeycloakService);
  });

  describe('crearAdministrador', () => {
    it('debe lanzar error si el email ya existe en BD', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 1 } as any);
      await expect(
        service.crearAdministrador({
          email: 'test@test.com',
          password: '123',
          nombre: 'Test',
          apellido: 'Admin',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('debe crear el usuario en Keycloak y MySQL', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      keycloakService.crearUsuario.mockResolvedValue('keycloak-id');
      usuariosRepository.crearUsuario.mockResolvedValue({ id: 1 } as any);
      administradoresRepository.crearAdministrador.mockResolvedValue({ id: 1 } as any);

      const result = await service.crearAdministrador({
        email: 'test@test.com',
        password: '123',
        nombre: 'Test',
        apellido: 'Admin',
      });

      expect(keycloakService.crearUsuario).toHaveBeenCalledWith('test@test.com', '123', 'Test', 'Admin');
      expect(keycloakService.asignarRol).toHaveBeenCalledWith('keycloak-id', 'ADMINISTRADOR');
      expect(usuariosRepository.crearUsuario).toHaveBeenCalled();
      expect(administradoresRepository.crearAdministrador).toHaveBeenCalled();
      expect(result.mensaje).toContain('creado correctamente');
    });
  });

  describe('cambiarEstadoAdministrador', () => {
    it('no debe permitir alterar a un SUPERADMIN', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, rol: 'SUPERADMIN' } as any);
      await expect(service.cambiarEstadoAdministrador(1, 'INACTIVO')).rejects.toThrow(ConflictException);
    });

    it('debe bloquear la cuenta global si se inactiva y no es barbero activo', async () => {
      const mockUser = {
        id: 1,
        keycloakId: 'key-1',
        rol: 'ADMINISTRADOR',
        administrador: { estado: 'ACTIVO' },
        barbero: null, // No es barbero
      };
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockUser as any);
      administradoresRepository.actualizarEstadoAdministrador.mockResolvedValue({} as any);

      await service.cambiarEstadoAdministrador(1, 'INACTIVO');

      expect(keycloakService.quitarRol).toHaveBeenCalledWith('key-1', 'ADMINISTRADOR');
      expect(keycloakService.cambiarEstadoUsuario).toHaveBeenCalledWith('key-1', false); // Bloquea acceso global
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(1, 'INACTIVO');
    });

    it('debe activar un administrador correctamente si no lo era', async () => {
      const mockUser = {
        id: 1,
        keycloakId: 'key-1',
        rol: 'BARBERO',
        administrador: null,
      };
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockUser as any);
      administradoresRepository.obtenerAdministradorPorUsuarioId.mockResolvedValue(null);
      administradoresRepository.crearAdministrador.mockResolvedValue({} as any);

      await service.cambiarEstadoAdministrador(1, 'ACTIVO');

      expect(keycloakService.asignarRol).toHaveBeenCalledWith('key-1', 'ADMINISTRADOR');
      expect(usuariosRepository.actualizarRol).toHaveBeenCalledWith(1, 'ADMINISTRADOR');
      expect(administradoresRepository.crearAdministrador).toHaveBeenCalledWith({ usuarioId: 1 });
    });
  });
});

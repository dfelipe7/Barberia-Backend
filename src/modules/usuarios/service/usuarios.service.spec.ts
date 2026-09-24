import { Test, TestingModule } from '@nestjs/testing';
import { UsuariosService } from './usuarios.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberosRepository } from '../repository/barberos.repository';
import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { AdministradoresService } from './administradores.service';
import { BarberosService } from './barberos.service';
import { ConflictException, ForbiddenException } from '@nestjs/common';
// Removed Prisma import

describe('UsuariosService', () => {
  let service: UsuariosService;
  let usuariosRepository: jest.Mocked<UsuariosRepository>;
  let barberosRepository: jest.Mocked<BarberosRepository>;
  let keycloakService: jest.Mocked<KeycloakService>;
  let authorizationService: jest.Mocked<UsuariosAuthorizationService>;
  let administradoresService: jest.Mocked<AdministradoresService>;
  let barberosService: jest.Mocked<BarberosService>;

  beforeEach(async () => {
    const mockUsuariosRepository = {
      obtenerUsuarioPorKeycloakId: jest.fn(),
      obtenerUsuarioPorId: jest.fn(),
      crearUsuario: jest.fn(),
      actualizarUsuario: jest.fn(),
      actualizarEstadoUsuario: jest.fn(),
    };

    const mockBarberosRepository = {
      actualizarPerfilBarbero: jest.fn(),
    };

    const mockKeycloakService = {
      obtenerUsuariosPorRol: jest.fn(),
      cambiarEstadoUsuario: jest.fn(),
      actualizarUsuario: jest.fn(),
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
        { provide: KeycloakService, useValue: mockKeycloakService },
        { provide: UsuariosAuthorizationService, useValue: mockAuthorizationService },
        { provide: AdministradoresService, useValue: mockAdministradoresService },
        { provide: BarberosService, useValue: mockBarberosService },
      ],
    }).compile();

    service = module.get<UsuariosService>(UsuariosService);
    usuariosRepository = module.get(UsuariosRepository);
    barberosRepository = module.get(BarberosRepository);
    keycloakService = module.get(KeycloakService);
    authorizationService = module.get(UsuariosAuthorizationService);
    administradoresService = module.get(AdministradoresService);
    barberosService = module.get(BarberosService);
  });

  describe('sincronizarSuperadmin', () => {
    it('debe lanzar ConflictException si no hay superadmins en Keycloak', async () => {
      keycloakService.obtenerUsuariosPorRol.mockResolvedValue([]);
      await expect(service.sincronizarSuperadmin()).rejects.toThrow(ConflictException);
    });

    it('debe crear un superadmin si no existe en la base de datos', async () => {
      keycloakService.obtenerUsuariosPorRol.mockResolvedValue([
        { id: '123', email: 'super@test.com', firstName: 'Super', lastName: 'Admin' },
      ]);
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(null);
      usuariosRepository.crearUsuario.mockResolvedValue({ id: 1, email: 'super@test.com' } as any);

      const resultados = await service.sincronizarSuperadmin();

      expect(usuariosRepository.crearUsuario).toHaveBeenCalledWith({
        keycloakId: '123',
        email: 'super@test.com',
        nombre: 'Super',
        apellido: 'Admin',
        rol: 'SUPERADMIN',
      });
      expect(resultados[0].mensaje).toContain('sincronizado correctamente');
    });

    it('debe activar al superadmin si ya existe', async () => {
      keycloakService.obtenerUsuariosPorRol.mockResolvedValue([
        { id: '123', email: 'super@test.com' },
      ]);
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 1 } as any);

      const resultados = await service.sincronizarSuperadmin();

      expect(keycloakService.cambiarEstadoUsuario).toHaveBeenCalledWith('123', true);
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(1, 'ACTIVO');
      expect(resultados[0].mensaje).toContain('verificado como ACTIVO');
    });
  });

  describe('obtenerMiPerfil', () => {
    it('debe devolver el usuario si existe', async () => {
      const mockUser = { id: 1, nombre: 'Test' };
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(mockUser as any);

      const result = await service.obtenerMiPerfil({ sub: '123' });
      expect(result).toEqual(mockUser);
    });

    it('debe lanzar ConflictException si no existe', async () => {
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(null);
      await expect(service.obtenerMiPerfil({ sub: '123' })).rejects.toThrow(ConflictException);
    });
  });

  describe('cambiarEstadoUsuario', () => {
    it('debe cambiar el estado en Keycloak y BD', async () => {
      const mockTarget = { id: 2, keycloakId: 'target' };
      const mockCaller = { id: 1, rol: 'SUPERADMIN' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockTarget as any);
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(mockCaller as any);
      usuariosRepository.actualizarEstadoUsuario.mockResolvedValue({} as any);

      await service.cambiarEstadoUsuario(2, { estado: 'INACTIVO' }, { sub: 'caller' });

      expect(authorizationService.verificarPermisosCambioEstadoCuenta).toHaveBeenCalledWith(mockCaller, mockTarget);
      expect(keycloakService.cambiarEstadoUsuario).toHaveBeenCalledWith('target', false);
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(2, 'INACTIVO');
    });
  });

  describe('actualizarUsuario', () => {
    it('debe actualizar datos personales en Keycloak y BD', async () => {
      const mockTarget = { id: 2, keycloakId: 'target', rol: 'BARBERO' };
      const mockCaller = { id: 1, rol: 'ADMINISTRADOR' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockTarget as any);
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(mockCaller as any);

      await service.actualizarUsuario(2, { nombre: 'Nuevo' }, { sub: 'caller' });

      expect(keycloakService.actualizarUsuario).toHaveBeenCalledWith('target', { nombre: 'Nuevo', apellido: undefined, email: undefined });
      expect(usuariosRepository.actualizarUsuario).toHaveBeenCalledWith(2, { nombre: 'Nuevo', apellido: undefined, email: undefined });
    });
  });
});

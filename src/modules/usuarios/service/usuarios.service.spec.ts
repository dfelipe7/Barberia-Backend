import { Test, TestingModule } from '@nestjs/testing';
import { UsuariosService } from './usuarios.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberosRepository } from '../repository/barberos.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { AdministradoresService } from './administradores.service';
import { BarberosService } from './barberos.service';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EstadoUsuario } from '../../../../generated/prisma/enums';

describe('UsuariosService', () => {
  let service: UsuariosService;
  let usuariosRepository: jest.Mocked<UsuariosRepository>;
  let barberosRepository: jest.Mocked<BarberosRepository>;
  let authorizationService: jest.Mocked<UsuariosAuthorizationService>;
  let administradoresService: jest.Mocked<AdministradoresService>;
  let barberosService: jest.Mocked<BarberosService>;

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
        {
          provide: UsuariosAuthorizationService,
          useValue: mockAuthorizationService,
        },
        {
          provide: AdministradoresService,
          useValue: mockAdministradoresService,
        },
        { provide: BarberosService, useValue: mockBarberosService },
      ],
    }).compile();

    service = module.get<UsuariosService>(UsuariosService);
    usuariosRepository = module.get(UsuariosRepository);
    barberosRepository = module.get(BarberosRepository);
    authorizationService = module.get(UsuariosAuthorizationService);
    administradoresService = module.get(AdministradoresService);
    barberosService = module.get(BarberosService);
  });

  describe('sincronizarSuperadmin', () => {
    it('debe devolver confirmación de superadministradores verificados', async () => {
      const resultados = await service.sincronizarSuperadmin();
      expect(resultados).toHaveLength(1);
      expect(resultados[0].mensaje).toContain(
        'Superadministradores verificados',
      );
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
      await expect(
        service.obtenerMiPerfil({ id: 999, sub: '999' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('obtenerUsuarioPorId', () => {
    it('debe lanzar ConflictException si el usuario solicitado no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(service.obtenerUsuarioPorId(999, { id: 1 })).rejects.toThrow(
        'El usuario no existe',
      );
    });

    it('debe lanzar ConflictException si el solicitante no existe en BD', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce({
        id: 2,
      } as any);
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(null);

      await expect(service.obtenerUsuarioPorId(2, { id: 999 })).rejects.toThrow(
        'El usuario autenticado no existe en la base de datos',
      );
    });

    it('debe validar permisos y retornar el perfil mapeado correctamente', async () => {
      const mockTarget = {
        id: 2,
        email: 'barbero@barberia.com',
        nombre: 'Carlos',
        apellido: 'Perez',
        rol: 'BARBERO',
        estado: 'ACTIVO',
        administrador: null,
        barbero: {
          id: 5,
          telefono: '3001234567',
          porcentajeComision: '45.5',
          fotoUrl: '/uploads/barbero.jpg',
          estado: 'ACTIVO',
        },
      };
      const mockCaller = { id: 1, rol: 'SUPERADMIN' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );

      const resultado = await service.obtenerUsuarioPorId(2, { id: 1 });

      expect(
        authorizationService.verificarPermisosConsulta,
      ).toHaveBeenCalledWith(mockCaller, mockTarget);
      expect(resultado.id).toBe(2);
      expect(resultado.barbero?.porcentajeComision).toBe(45.5);
    });
  });

  describe('actualizarUsuario', () => {
    it('debe lanzar ConflictException si el usuario destino no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(
        service.actualizarUsuario(999, {}, { id: 1 }),
      ).rejects.toThrow('El usuario no existe');
    });

    it('debe lanzar ConflictException si el usuario solicitante no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce({
        id: 2,
      } as any);
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(null);

      await expect(
        service.actualizarUsuario(2, {}, { id: 999 }),
      ).rejects.toThrow('El usuario autenticado no existe en la base de datos');
    });

    it('debe actualizar datos personales en BD exitosamente', async () => {
      const mockTarget = { id: 2, rol: 'BARBERO' };
      const mockCaller = { id: 1, rol: 'ADMINISTRADOR' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );
      usuariosRepository.actualizarUsuario.mockResolvedValue({} as any);
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );

      await service.actualizarUsuario(
        2,
        { nombre: 'Nuevo' },
        { id: 1, sub: '1' },
      );

      expect(usuariosRepository.actualizarUsuario).toHaveBeenCalledWith(2, {
        nombre: 'Nuevo',
        apellido: undefined,
        email: undefined,
      });
    });

    it('debe rechazar que un no-SUPERADMIN modifique el rol de Administrador', async () => {
      const mockTarget = { id: 2, rol: 'BARBERO', administrador: null };
      const mockCaller = { id: 3, rol: 'ADMINISTRADOR' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );

      await expect(
        service.actualizarUsuario(2, { esAdministrador: true }, { id: 3 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe impedir que el superadmin se retire a sí mismo el rol de Administrador', async () => {
      const mockTarget = {
        id: 1,
        rol: 'ADMINISTRADOR',
        administrador: { estado: 'ACTIVO' },
      };
      const mockCaller = { id: 1, rol: 'SUPERADMIN' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );

      await expect(
        service.actualizarUsuario(1, { esAdministrador: false }, { id: 1 }),
      ).rejects.toThrow(ConflictException);
    });

    it('debe cambiar estado de administrador cuando un superadmin lo autoriza', async () => {
      const mockTarget = {
        id: 2,
        rol: 'BARBERO',
        administrador: { estado: 'INACTIVO' },
      };
      const mockCaller = { id: 1, rol: 'SUPERADMIN' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );

      await service.actualizarUsuario(2, { esAdministrador: true }, { id: 1 });

      expect(
        administradoresService.cambiarEstadoAdministrador,
      ).toHaveBeenCalledWith(2, 'ACTIVO');
    });

    it('debe rechazar que un barbero modifique o revoque su propio rol de barbero', async () => {
      const mockTarget = {
        id: 2,
        rol: 'BARBERO',
        barbero: { estado: 'ACTIVO' },
      };
      const mockCaller = { id: 2, rol: 'BARBERO' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );

      await expect(
        service.actualizarUsuario(2, { esBarbero: false }, { id: 2 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe activar rol de barbero configurando el perfil', async () => {
      const mockTarget = { id: 2, rol: 'CLIENTE', barbero: null };
      const mockCaller = { id: 1, rol: 'SUPERADMIN' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );

      await service.actualizarUsuario(
        2,
        { esBarbero: true, telefono: '3111234567' },
        { id: 1 },
      );

      expect(barberosService.configurarBarberoPorId).toHaveBeenCalledWith(2, {
        telefono: '3111234567',
        porcentajeComision: 50,
      });
    });

    it('debe inactivar rol de barbero si esBarbero es false', async () => {
      const mockTarget = {
        id: 2,
        rol: 'BARBERO',
        barbero: { estado: 'ACTIVO' },
      };
      const mockCaller = { id: 1, rol: 'SUPERADMIN' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );

      await service.actualizarUsuario(2, { esBarbero: false }, { id: 1 });

      expect(barberosService.cambiarEstadoBarbero).toHaveBeenCalledWith(
        2,
        { estado: EstadoUsuario.INACTIVO },
        { id: 1 },
      );
    });

    it('debe actualizar teléfono y comisión de un barbero existente', async () => {
      const mockTarget = {
        id: 2,
        rol: 'BARBERO',
        barbero: { estado: 'ACTIVO' },
      };
      const mockCaller = { id: 1, rol: 'SUPERADMIN' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );

      await service.actualizarUsuario(
        2,
        { telefono: '3200000000', porcentajeComision: 60 },
        { id: 1 },
      );

      expect(
        authorizationService.verificarPermisosComision,
      ).toHaveBeenCalledWith(mockCaller, mockTarget);
      expect(barberosRepository.actualizarPerfilBarbero).toHaveBeenCalledWith(
        2,
        {
          telefono: '3200000000',
          porcentajeComision: 60,
          fotoUrl: undefined,
        },
      );
    });
  });

  describe('cambiarEstadoUsuario', () => {
    it('debe lanzar ConflictException si el usuario a modificar no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(
        service.cambiarEstadoUsuario(
          999,
          { estado: 'INACTIVO' as any },
          { id: 1 },
        ),
      ).rejects.toThrow('El usuario no existe');
    });

    it('debe lanzar ConflictException si el usuario autenticado no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce({
        id: 2,
      } as any);
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(null);

      await expect(
        service.cambiarEstadoUsuario(
          2,
          { estado: 'INACTIVO' as any },
          { id: 999 },
        ),
      ).rejects.toThrow('El usuario autenticado no existe en la base de datos');
    });

    it('debe cambiar el estado en BD exitosamente', async () => {
      const mockTarget = { id: 2 };
      const mockCaller = { id: 1, rol: 'SUPERADMIN' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );
      usuariosRepository.actualizarEstadoUsuario.mockResolvedValue({} as any);

      await service.cambiarEstadoUsuario(
        2,
        { estado: 'INACTIVO' },
        { id: 1, sub: '1' },
      );

      expect(
        authorizationService.verificarPermisosCambioEstadoCuenta,
      ).toHaveBeenCalledWith(mockCaller, mockTarget);
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(
        2,
        'INACTIVO',
      );
    });
  });
});

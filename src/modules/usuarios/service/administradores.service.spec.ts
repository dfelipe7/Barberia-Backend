import { Test, TestingModule } from '@nestjs/testing';
import { AdministradoresService } from './administradores.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { AdministradoresRepository } from '../repository/administradores.repository';
import { ConflictException } from '@nestjs/common';
import { FiltroAdministradoresDto } from '../dto/dto-peticion/filtro-administradores.dto';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';

describe('AdministradoresService', () => {
  let service: AdministradoresService;
  let usuariosRepository: jest.Mocked<UsuariosRepository>;
  let administradoresRepository: jest.Mocked<AdministradoresRepository>;
  let prismaMock: any;

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

    prismaMock = {
      administrador: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => {
        const tx = {
          usuario: { create: jest.fn().mockResolvedValue({ id: 1 }) },
          administrador: { create: jest.fn().mockResolvedValue({ id: 1 }) },
        };
        return cb(tx);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdministradoresService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
        {
          provide: NegocioAislamientoService,
          useValue: { negocioIdRequerido: () => 1 },
        },
        {
          provide: AdministradoresRepository,
          useValue: mockAdministradoresRepository,
        },
      ],
    }).compile();

    service = module.get<AdministradoresService>(AdministradoresService);
    usuariosRepository = module.get(UsuariosRepository);
    administradoresRepository = module.get(AdministradoresRepository);
  });

  describe('crearAdministrador', () => {
    it('debe lanzar error si el email ya existe en BD', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({
        id: 1,
      } as any);
      prismaMock.administrador.findUnique.mockResolvedValue({
        id: 10,
        estado: 'ACTIVO',
      });
      await expect(
        service.crearAdministrador({
          email: 'test@test.com',
          nombre: 'Test',
          apellido: 'Admin',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('debe crear el usuario y perfil en MySQL exitosamente', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);

      const result = await service.crearAdministrador({
        email: 'test@test.com',
        nombre: 'Test',
        apellido: 'Admin',
      });

      expect(result.mensaje).toContain('creado correctamente');
      expect(result.administrador).toBeDefined();
    });

    it('debe lanzar ConflictException si la transacción falla', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      prismaMock.$transaction.mockRejectedValue(new Error('DB error'));

      await expect(
        service.crearAdministrador({
          email: 'test@test.com',
          nombre: 'Test',
          apellido: 'Admin',
        }),
      ).rejects.toThrow(
        'El administrador no pudo registrarse. Intente nuevamente.',
      );
    });
  });

  describe('cambiarEstadoAdministrador', () => {
    it('debe lanzar error si el usuario no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(
        service.cambiarEstadoAdministrador(999, 'ACTIVO'),
      ).rejects.toThrow('El usuario no existe');
    });

    it('no debe permitir alterar al SUPERADMIN de ESTA barbería', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        rol: 'PERSONAL',
        // Membresía SUPERADMIN en el negocio del contexto.
        administradores: [
          { negocioId: 1, estado: 'ACTIVO', superadmin: true },
        ],
      } as any);
      await expect(
        service.cambiarEstadoAdministrador(1, 'INACTIVO'),
      ).rejects.toThrow(ConflictException);
    });

    it('un Usuario.rol SUPERADMIN sin membresía NO goza de protección ni de acceso', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        rol: 'SUPERADMIN',
        administradores: [],
      } as any);
      // No es administrador de esta barbería: no existe aquí.
      await expect(
        service.cambiarEstadoAdministrador(1, 'INACTIVO'),
      ).rejects.toThrow('El usuario no es administrador de esta barbería');
    });

    it('debe rechazar activación si ya es administrador activo', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        rol: 'PERSONAL',
        administradores: [{ estado: 'ACTIVO', negocioId: 1 }],
      } as any);

      await expect(
        service.cambiarEstadoAdministrador(1, 'ACTIVO'),
      ).rejects.toThrow('Este usuario ya tiene privilegios de Administrador');
    });

    it('debe reactivar a un administrador existente', async () => {
      const mockUser = {
        id: 1,
        rol: 'PERSONAL',
        administradores: [{ estado: 'INACTIVO', negocioId: 1 }],
      };
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockUser as any);
      administradoresRepository.obtenerAdministradorPorUsuarioId.mockResolvedValue(
        { id: 10 } as any,
      );
      administradoresRepository.actualizarEstadoAdministrador.mockResolvedValue(
        { id: 10, estado: 'ACTIVO' } as any,
      );

      const res = await service.cambiarEstadoAdministrador(1, 'ACTIVO');
      expect(res.mensaje).toContain('promovido a Administrador exitosamente');
      expect(
        administradoresRepository.actualizarEstadoAdministrador,
      ).toHaveBeenCalledWith(1, 'ACTIVO');
    });

    it('debe lanzar error si la activación falla en el repository', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        rol: 'PERSONAL',
        administradores: [],
      } as any);
      administradoresRepository.obtenerAdministradorPorUsuarioId.mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.cambiarEstadoAdministrador(1, 'ACTIVO'),
      ).rejects.toThrow(
        'No se pudo promover al usuario en la base de datos local',
      );
    });

    it('debe rechazar inactivación si el usuario no tiene perfil de administrador', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        rol: 'CLIENTE',
        administradores: [],
      } as any);

      await expect(
        service.cambiarEstadoAdministrador(1, 'INACTIVO'),
      ).rejects.toThrow('El usuario no es administrador de esta barbería');
    });

    it('debe restaurar rol a BARBERO si el usuario degradado también es barbero', async () => {
      const mockUser = {
        id: 1,
        rol: 'PERSONAL',
        administradores: [{ estado: 'ACTIVO', negocioId: 1 }],
        barberos: [{ estado: 'ACTIVO', negocioId: 1 }],
      };
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockUser as any);
      administradoresRepository.actualizarEstadoAdministrador.mockResolvedValue(
        {} as any,
      );

      await service.cambiarEstadoAdministrador(1, 'INACTIVO');

      expect(usuariosRepository.actualizarRol).not.toHaveBeenCalled();
      expect(
        administradoresRepository.actualizarEstadoAdministrador,
      ).toHaveBeenCalledWith(1, 'INACTIVO');
      expect(usuariosRepository.actualizarEstadoUsuario).not.toHaveBeenCalled();
    });

    it('debe bloquear la cuenta global si se inactiva y no es barbero activo', async () => {
      const mockUser = {
        id: 1,
        rol: 'PERSONAL',
        administradores: [{ estado: 'ACTIVO', negocioId: 1 }],
        barberos: [{ negocioId: 1 }],
      };
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockUser as any);
      administradoresRepository.actualizarEstadoAdministrador.mockResolvedValue(
        {} as any,
      );

      await service.cambiarEstadoAdministrador(1, 'INACTIVO');

      expect(
        administradoresRepository.actualizarEstadoAdministrador,
      ).toHaveBeenCalledWith(1, 'INACTIVO');
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(
        1,
        'INACTIVO',
      );
    });

    it('debe lanzar error si la inactivación falla en el repository', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        rol: 'PERSONAL',
        administradores: [{ estado: 'ACTIVO', negocioId: 1 }],
      } as any);
      administradoresRepository.actualizarEstadoAdministrador.mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.cambiarEstadoAdministrador(1, 'INACTIVO'),
      ).rejects.toThrow(
        'No se pudo degradar al usuario en la base de datos local',
      );
    });

    it('debe activar un administrador correctamente si no lo era', async () => {
      const mockUser = {
        id: 1,
        rol: 'PERSONAL',
        administradores: [],
      };
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockUser as any);
      administradoresRepository.obtenerAdministradorPorUsuarioId.mockResolvedValue(
        null,
      );
      administradoresRepository.crearAdministrador.mockResolvedValue({} as any);

      await service.cambiarEstadoAdministrador(1, 'ACTIVO');

      expect(usuariosRepository.actualizarRol).not.toHaveBeenCalled();
      expect(administradoresRepository.crearAdministrador).toHaveBeenCalledWith(
        { usuarioId: 1 },
      );
    });
  });

  describe('obtenerAdministradores', () => {
    it('debe obtener la lista de administradores aplicando el filtro de búsqueda y estado', async () => {
      const mockAdminsPrisma = [
        {
          id: 1,
          estado: 'ACTIVO',
          usuario: {
            id: 100,
            nombre: 'Admin',
            apellido: 'Sistema',
            email: 'admin@barberia.com',
            rol: 'PERSONAL',
            estado: 'ACTIVO',
            barberos: [],
          },
        },
      ];
      administradoresRepository.obtenerAdministradores.mockResolvedValue(
        mockAdminsPrisma as any,
      );

      const filtro: FiltroAdministradoresDto = {
        nombre: 'Admin',
        estado: EstadoUsuario.ACTIVO,
      };
      const resultado = await service.obtenerAdministradores(filtro);

      expect(
        administradoresRepository.obtenerAdministradores,
      ).toHaveBeenCalledWith(filtro);
      expect(resultado).toHaveLength(1);
      expect(resultado[0]).toEqual({
        id: 100,
        nombre: 'Admin',
        apellido: 'Sistema',
        email: 'admin@barberia.com',
        estado: 'ACTIVO',
        estadoAdmin: 'ACTIVO',
        esBarbero: false,
        estadoBarbero: undefined,
        esSuperAdmin: false,
      });
    });
  });
});

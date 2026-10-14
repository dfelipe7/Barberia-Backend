import { Test, TestingModule } from '@nestjs/testing';
import { AdministradoresService } from './administradores.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { AdministradoresRepository } from '../repository/administradores.repository';
import { ConflictException } from '@nestjs/common';
import { FiltroAdministradoresDto } from '../dto/dto-peticion/filtro-administradores.dto';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AdministradoresService', () => {
  let service: AdministradoresService;
  let usuariosRepository: jest.Mocked<UsuariosRepository>;
  let administradoresRepository: jest.Mocked<AdministradoresRepository>;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdministradoresService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(async (cb) => {
              const tx = {
                usuario: { create: jest.fn().mockResolvedValue({ id: 1 }) },
                administrador: { create: jest.fn().mockResolvedValue({ id: 1 }) },
              };
              return cb(tx);
            }),
          },
        },
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
        { provide: AdministradoresRepository, useValue: mockAdministradoresRepository },
      ],
    }).compile();

    service = module.get<AdministradoresService>(AdministradoresService);
    usuariosRepository = module.get(UsuariosRepository);
    administradoresRepository = module.get(AdministradoresRepository);
  });

  describe('crearAdministrador', () => {
    it('debe lanzar error si el email ya existe en BD', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 1 } as any);
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
  });

  describe('cambiarEstadoAdministrador', () => {
    it('no debe permitir alterar a un SUPERADMIN', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, rol: 'SUPERADMIN' } as any);
      await expect(service.cambiarEstadoAdministrador(1, 'INACTIVO')).rejects.toThrow(ConflictException);
    });

    it('debe bloquear la cuenta global si se inactiva y no es barbero activo', async () => {
      const mockUser = {
        id: 1,
        rol: 'ADMINISTRADOR',
        administrador: { estado: 'ACTIVO' },
        barbero: null, // No es barbero
      };
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockUser as any);
      administradoresRepository.actualizarEstadoAdministrador.mockResolvedValue({} as any);

      await service.cambiarEstadoAdministrador(1, 'INACTIVO');

      expect(administradoresRepository.actualizarEstadoAdministrador).toHaveBeenCalledWith(1, 'INACTIVO');
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(1, 'INACTIVO');
    });

    it('debe activar un administrador correctamente si no lo era', async () => {
      const mockUser = {
        id: 1,
        rol: 'BARBERO',
        administrador: null,
      };
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(mockUser as any);
      administradoresRepository.obtenerAdministradorPorUsuarioId.mockResolvedValue(null);
      administradoresRepository.crearAdministrador.mockResolvedValue({} as any);

      await service.cambiarEstadoAdministrador(1, 'ACTIVO');

      expect(usuariosRepository.actualizarRol).toHaveBeenCalledWith(1, 'ADMINISTRADOR');
      expect(administradoresRepository.crearAdministrador).toHaveBeenCalledWith({ usuarioId: 1 });
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
            rol: 'ADMINISTRADOR',
            estado: 'ACTIVO',
            barbero: null,
          },
        },
      ];
      administradoresRepository.obtenerAdministradores.mockResolvedValue(mockAdminsPrisma as any);

      const filtro: FiltroAdministradoresDto = { nombre: 'Admin', estado: EstadoUsuario.ACTIVO };
      const resultado = await service.obtenerAdministradores(filtro);

      expect(administradoresRepository.obtenerAdministradores).toHaveBeenCalledWith(filtro);
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
      });
    });
  });
});


import { Test, TestingModule } from '@nestjs/testing';
import { UsuariosService } from './usuarios.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberosRepository } from '../repository/barberos.repository';
import { AdministradoresRepository } from '../repository/administradores.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { AdministradoresService } from './administradores.service';
import { BarberosService } from './barberos.service';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { TipoMembresiaEstado } from '../dto/dto-peticion/cambiar-estado-usuario-gestion.dto';
import { ActualizarUsuarioDto } from '../dto/dto-peticion/actualizar-usuario.dto';

type UsuarioMock = Awaited<
  ReturnType<UsuariosRepository['obtenerUsuarioPorId']>
>;

describe('UsuariosService', () => {
  let service: UsuariosService;
  let usuariosRepository: jest.Mocked<UsuariosRepository>;
  let barberosRepository: jest.Mocked<BarberosRepository>;
  let administradoresRepository: jest.Mocked<AdministradoresRepository>;
  let authorizationService: jest.Mocked<UsuariosAuthorizationService>;
  let administradoresService: jest.Mocked<AdministradoresService>;
  let barberosService: jest.Mocked<BarberosService>;

  /**
   * Sesiones de la petición: el payload del token con los roles EFECTIVOS en
   * el negocio. Es el actor con el que se autoriza.
   */
  const sesionSuperadmin = {
    id: 1,
    roles: ['SUPERADMIN'],
    superadmin: true,
    negocioId: 10,
  };
  const sesionAdministrador = {
    id: 3,
    roles: ['ADMINISTRADOR'],
    superadmin: false,
    negocioId: 10,
  };
  const sesionBarbero = {
    id: 2,
    roles: ['BARBERO'],
    superadmin: false,
    negocioId: 10,
  };

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
      actualizarEstadoBarbero: jest.fn(),
    };

    const mockAdministradoresRepository = {
      actualizarEstadoAdministrador: jest.fn(),
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
          provide: AdministradoresRepository,
          useValue: mockAdministradoresRepository,
        },
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
    administradoresRepository = module.get(AdministradoresRepository);
    authorizationService = module.get(UsuariosAuthorizationService);
    administradoresService = module.get(AdministradoresService);
    barberosService = module.get(BarberosService);
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

    it('debe resolver al usuario autenticado por su email', async () => {
      const mockUser = {
        id: 2,
        nombre: 'Por Email',
        apellido: 'User',
        email: 'por.email@barberia.com',
        rol: 'PERSONAL',
        estado: 'ACTIVO',
        administrador: null,
        barbero: null,
      };
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(
        mockUser as any,
      );

      const result = await service.obtenerMiPerfil({
        email: 'por.email@barberia.com',
      });

      expect(usuariosRepository.obtenerUsuarioPorEmail).toHaveBeenCalledWith(
        'por.email@barberia.com',
      );
      expect(result).toEqual(mockUser);
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
        rol: 'PERSONAL',
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

      const resultado = await service.obtenerUsuarioPorId(2, sesionSuperadmin);

      expect(
        authorizationService.verificarPermisosConsulta,
      ).toHaveBeenCalledWith(sesionSuperadmin, mockTarget);
      expect(resultado.id).toBe(2);
      expect(resultado.barbero?.porcentajeComision).toBe(45.5);
    });
  });

  describe('actualizarUsuario', () => {
    it('debe lanzar ConflictException si el usuario destino no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(
        service.actualizarUsuario(999, {}, sesionSuperadmin),
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
      const mockTarget = { id: 2, rol: 'PERSONAL' };
      const mockCaller = { id: 1, rol: 'PERSONAL' };

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

      await service.actualizarUsuario(2, { nombre: 'Nuevo' }, sesionSuperadmin);

      expect(usuariosRepository.actualizarUsuario).toHaveBeenCalledWith(2, {
        nombre: 'Nuevo',
        apellido: undefined,
      });
    });

    it('no reenvía el email al repositorio aunque llegue en el cuerpo', async () => {
      const mockTarget = { id: 2, rol: 'PERSONAL' };
      const mockCaller = { id: 1, rol: 'PERSONAL' };

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
        {
          nombre: 'Nuevo',
          email: 'inyectado@correo.com',
        } as ActualizarUsuarioDto,
        sesionSuperadmin,
      );

      expect(usuariosRepository.actualizarUsuario).toHaveBeenCalledWith(2, {
        nombre: 'Nuevo',
        apellido: undefined,
      });
    });

    it('debe rechazar que un no-SUPERADMIN modifique el rol de Administrador', async () => {
      const mockTarget = { id: 2, rol: 'PERSONAL', administrador: null };
      const mockCaller = { id: 3, rol: 'PERSONAL' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );

      await expect(
        service.actualizarUsuario(
          2,
          { esAdministrador: true },
          sesionAdministrador,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe impedir que el superadmin se retire a sí mismo el rol de Administrador', async () => {
      const mockTarget = {
        id: 1,
        rol: 'PERSONAL',
        administrador: { estado: 'ACTIVO', negocioId: 10 },
      };
      const mockCaller = { id: 1, rol: 'SUPERADMIN' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );

      await expect(
        service.actualizarUsuario(
          1,
          { esAdministrador: false },
          sesionSuperadmin,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('debe cambiar estado de administrador cuando un superadmin lo autoriza', async () => {
      const mockTarget = {
        id: 2,
        rol: 'PERSONAL',
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

      await service.actualizarUsuario(
        2,
        { esAdministrador: true },
        sesionSuperadmin,
      );

      expect(
        administradoresService.cambiarEstadoAdministrador,
      ).toHaveBeenCalledWith(2, 'ACTIVO');
    });

    it('debe omitir el cambio de rol de Administrador cuando el estado solicitado coincide con el actual', async () => {
      const mockTarget = { id: 2, rol: 'PERSONAL', administrador: null };
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
        { esAdministrador: false },
        sesionSuperadmin,
      );

      expect(
        administradoresService.cambiarEstadoAdministrador,
      ).not.toHaveBeenCalled();
    });

    it('debe rechazar que un barbero modifique o revoque su propio rol de barbero', async () => {
      const mockTarget = {
        id: 2,
        rol: 'PERSONAL',
        barbero: { estado: 'ACTIVO', negocioId: 10 },
      };
      const mockCaller = { id: 2, rol: 'PERSONAL' };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockTarget as any,
      );
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValueOnce(
        mockCaller as any,
      );

      await expect(
        service.actualizarUsuario(2, { esBarbero: false }, sesionBarbero),
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
        sesionSuperadmin,
      );

      expect(barberosService.configurarBarberoPorId).toHaveBeenCalledWith(2, {
        telefono: '3111234567',
        porcentajeComision: 50,
      });
    });

    it('debe inactivar rol de barbero si esBarbero es false', async () => {
      const mockTarget = {
        id: 2,
        rol: 'PERSONAL',
        barbero: { estado: 'ACTIVO', negocioId: 10 },
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
        { esBarbero: false },
        sesionSuperadmin,
      );

      expect(barberosService.cambiarEstadoBarbero).toHaveBeenCalledWith(
        2,
        { estado: EstadoUsuario.INACTIVO },
        sesionSuperadmin,
      );
    });

    it('debe actualizar teléfono y comisión de un barbero existente', async () => {
      const mockTarget = {
        id: 2,
        rol: 'PERSONAL',
        barbero: { estado: 'ACTIVO', negocioId: 10 },
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
        sesionSuperadmin,
      );

      expect(
        authorizationService.verificarPermisosComision,
      ).toHaveBeenCalledWith(sesionSuperadmin, mockTarget);
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
    const prepararLlamada = (target: any, refrescado: any = target) => {
      usuariosRepository.obtenerUsuarioPorId
        .mockResolvedValueOnce(target as UsuarioMock)
        .mockResolvedValueOnce({ id: 1, rol: 'SUPERADMIN' } as UsuarioMock)
        .mockResolvedValueOnce(refrescado as UsuarioMock);
    };

    it('debe lanzar ConflictException si el usuario a modificar no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(
        service.cambiarEstadoUsuario(
          999,
          {
            estado: 'INACTIVO',
            tipo: TipoMembresiaEstado.ADMINISTRADOR,
          },
          sesionSuperadmin,
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
          {
            estado: 'INACTIVO',
            tipo: TipoMembresiaEstado.ADMINISTRADOR,
          },
          { id: 999 },
        ),
      ).rejects.toThrow('El usuario autenticado no existe en la base de datos');
    });

    it('actualiza solo la membresía de administrador pedida', async () => {
      const target = {
        id: 2,
        administradores: [{ negocioId: 10, estado: 'ACTIVO' }],
      };
      prepararLlamada(target);

      await service.cambiarEstadoUsuario(
        2,
        {
          estado: 'INACTIVO',
          tipo: TipoMembresiaEstado.ADMINISTRADOR,
        },
        sesionSuperadmin,
      );

      expect(
        authorizationService.verificarPermisosCambioEstadoCuenta,
      ).toHaveBeenCalledWith(
        sesionSuperadmin,
        expect.objectContaining({
          id: 2,
          administrador: { negocioId: 10, estado: 'ACTIVO' },
        }),
      );
      expect(
        administradoresRepository.actualizarEstadoAdministrador,
      ).toHaveBeenCalledWith(2, 'INACTIVO');
      expect(
        barberosRepository.actualizarEstadoBarbero,
      ).not.toHaveBeenCalled();
      expect(
        usuariosRepository.actualizarEstadoUsuario,
      ).not.toHaveBeenCalled();
    });

    it('actualiza solo la membresía de barbero pedida', async () => {
      const target = {
        id: 2,
        barberos: [{ negocioId: 10, estado: 'ACTIVO' }],
      };
      prepararLlamada(target);

      await service.cambiarEstadoUsuario(
        2,
        {
          estado: 'INACTIVO',
          tipo: TipoMembresiaEstado.BARBERO,
        },
        sesionSuperadmin,
      );

      expect(
        barberosRepository.actualizarEstadoBarbero,
      ).toHaveBeenCalledWith(2, 'INACTIVO');
      expect(
        administradoresRepository.actualizarEstadoAdministrador,
      ).not.toHaveBeenCalled();
      expect(
        usuariosRepository.actualizarEstadoUsuario,
      ).not.toHaveBeenCalled();
    });

    it('actualiza ambas membresías cuando tipo es ambos', async () => {
      const target = {
        id: 2,
        administradores: [{ negocioId: 10, estado: 'ACTIVO' }],
        barberos: [{ negocioId: 10, estado: 'ACTIVO' }],
      };
      prepararLlamada(target);

      await service.cambiarEstadoUsuario(
        2,
        { estado: 'INACTIVO', tipo: TipoMembresiaEstado.AMBOS },
        sesionSuperadmin,
      );

      expect(
        administradoresRepository.actualizarEstadoAdministrador,
      ).toHaveBeenCalledWith(2, 'INACTIVO');
      expect(
        barberosRepository.actualizarEstadoBarbero,
      ).toHaveBeenCalledWith(2, 'INACTIVO');
    });

    it('responde 409 si la membresía pedida no existe en el negocio', async () => {
      const target = { id: 2, administradores: [] };
      prepararLlamada(target);

      await expect(
        service.cambiarEstadoUsuario(
          2,
          {
            estado: 'INACTIVO',
            tipo: TipoMembresiaEstado.ADMINISTRADOR,
          },
          sesionSuperadmin,
        ),
      ).rejects.toThrow('El usuario no es administrador de esta barbería');
      expect(
        administradoresRepository.actualizarEstadoAdministrador,
      ).not.toHaveBeenCalled();
    });

    it('autoriza antes de revelar si la membresía existe', async () => {
      const target = { id: 2, administradores: [] };
      prepararLlamada(target);
      authorizationService.verificarPermisosCambioEstadoCuenta.mockImplementationOnce(
        () => {
          throw new ForbiddenException('sin permisos');
        },
      );

      await expect(
        service.cambiarEstadoUsuario(
          2,
          {
            estado: 'INACTIVO',
            tipo: TipoMembresiaEstado.ADMINISTRADOR,
          },
          sesionSuperadmin,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(
        administradoresRepository.actualizarEstadoAdministrador,
      ).not.toHaveBeenCalled();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { BarberosService } from './barberos.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberosRepository } from '../repository/barberos.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
jest.mock('../../../../generated/prisma/enums', () => ({
  EstadoUsuario: { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' },
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

import * as fs from 'node:fs';
import { EstadoUsuario } from '../../../../generated/prisma/enums';

describe('BarberosService', () => {
  let service: BarberosService;
  let usuariosRepository: any;
  let barberosRepository: any;
  let authorizationService: any;
  let prismaService: any;

  beforeEach(async () => {
    const mockUsuariosRepository = {
      obtenerUsuarioPorId: jest.fn(),
      obtenerUsuarioPorGoogleId: jest.fn(),
      obtenerUsuarioPorEmail: jest.fn(),
      crearUsuario: jest.fn(),
      actualizarEstadoUsuario: jest.fn(),
    };

    const mockBarberosRepository = {
      crearBarberoNuevo: jest.fn(),
      crearPerfilBarbero: jest.fn(),
      actualizarPerfilBarbero: jest.fn(),
      actualizarComision: jest.fn(),
      actualizarEstadoBarbero: jest.fn(),
      obtenerBarberoPorUsuarioId: jest.fn(),
      obtenerBarberosCatalogo: jest.fn(),
      obtenerBarberosGestion: jest.fn(),
    };

    const mockAuthorizationService = {
      verificarPermisosComision: jest.fn(),
      verificarPermisosEdicion: jest.fn(),
      verificarPermisosCambioEstadoBarbero: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarberosService,
        {
          provide: PrismaService,
          useValue: {
            barbero: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ id: 1, estado: 'ACTIVO' }),
            },
            $transaction: jest.fn(async (cb) => {
              const tx = {
                usuario: { create: jest.fn().mockResolvedValue({ id: 1 }) },
                barbero: { create: jest.fn().mockResolvedValue({ id: 1 }) },
              };
              return await cb(tx);
            }),
          },
        },
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
        {
          provide: NegocioAislamientoService,
          useValue: { negocioIdRequerido: () => 1 },
        },
        { provide: BarberosRepository, useValue: mockBarberosRepository },
        {
          provide: UsuariosAuthorizationService,
          useValue: mockAuthorizationService,
        },
      ],
    }).compile();

    service = module.get<BarberosService>(BarberosService);
    usuariosRepository = module.get(UsuariosRepository);
    barberosRepository = module.get(BarberosRepository);
    authorizationService = module.get(UsuariosAuthorizationService);
    prismaService = module.get(PrismaService);
    jest.clearAllMocks();
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // crearBarbero
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('crearBarbero', () => {
    it('debe crear barbero correctamente', async () => {
      const dto: any = {
        email: 'b@b.com',
        nombre: 'B',
        apellido: 'P',
        telefono: '300',
        porcentajeComision: 50,
      };
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      usuariosRepository.crearUsuario.mockResolvedValue({ id: 1 });
      barberosRepository.crearBarberoNuevo.mockResolvedValue({ id: 1 });

      const result = await service.crearBarbero(dto);
      expect(result.mensaje).toContain('creado correctamente');
      expect(result.barbero).toBeDefined();
    });

    it('debe lanzar ConflictException si el email ya existe', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 1 });
      await expect(
        service.crearBarbero({ email: 'b@b.com' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('debe lanzar ConflictException si falla el guardado en DB', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      jest
        .spyOn(prismaService, '$transaction')
        .mockRejectedValueOnce(new Error('DB error'));

      await expect(
        service.crearBarbero({
          email: 'b@b.com',
          nombre: 'a',
          apellido: 'b',
        } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // configurarBarbero
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('configurarBarbero', () => {
    it('debe crear perfil de barbero nuevo', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({
        id: 1,
        barberos: [],
      });
      barberosRepository.crearPerfilBarbero.mockResolvedValue({ id: 1 });

      await service.configurarBarbero('b@b.com', {
        telefono: '300',
        porcentajeComision: 50,
      });
      expect(barberosRepository.crearPerfilBarbero).toHaveBeenCalled();
    });

    it('debe lanzar ConflictException si el usuario no existe', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      await expect(
        service.configurarBarbero('b@b.com', {} as any),
      ).rejects.toThrow('El usuario no existe');
    });

    it('debe lanzar ConflictException si ya es barbero ACTIVO', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({
        id: 1,
        barberos: [{ estado: 'ACTIVO', negocioId: 1 }],
      });
      await expect(
        service.configurarBarbero('b@b.com', {} as any),
      ).rejects.toThrow('ya está configurado como barbero');
    });

    it('debe reactivar barbero INACTIVO', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({
        id: 1,
        barberos: [{ estado: 'INACTIVO', negocioId: 1 }],
      });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      await service.configurarBarbero('b@b.com', {
        telefono: '300',
        porcentajeComision: 50,
      });
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(
        1,
        'ACTIVO',
      );
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // configurarBarberoPorId
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('configurarBarberoPorId', () => {
    it('debe crear perfil de barbero para admin', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [],
        administradores: [{ estado: 'ACTIVO', negocioId: 1 }],
        rol: 'PERSONAL',
      });
      barberosRepository.crearPerfilBarbero.mockResolvedValue({ id: 1 });

      await service.configurarBarberoPorId(1, {
        telefono: '300',
        porcentajeComision: 50,
      });
      expect(barberosRepository.crearPerfilBarbero).toHaveBeenCalled();
    });

    it('debe lanzar ConflictException si el usuario no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(
        service.configurarBarberoPorId(1, {} as any),
      ).rejects.toThrow('El usuario no existe');
    });

    it('debe lanzar ConflictException si ya es barbero ACTIVO', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ estado: 'ACTIVO', negocioId: 1 }],
      });
      await expect(
        service.configurarBarberoPorId(1, {} as any),
      ).rejects.toThrow('ya está configurado como barbero');
    });

    it('debe reactivar barbero INACTIVO por id', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ estado: 'INACTIVO', negocioId: 1 }],
      });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});
      await service.configurarBarberoPorId(1, {
        telefono: '300',
        porcentajeComision: 50,
      });
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(
        1,
        'ACTIVO',
      );
    });

    it('debe lanzar ConflictException si el usuario no es administrador de ESTA barbería', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [],
        administradores: [],
        rol: 'PERSONAL',
      });
      await expect(
        service.configurarBarberoPorId(1, {} as any),
      ).rejects.toThrow('El usuario no es administrador de esta barbería');
    });

    it('un Usuario.rol SUPERADMIN sin membresía en este negocio NO puede convertirse en barbero', async () => {
      // El carácter global `Usuario.rol` no concede ningún privilegio: la
      // condición es la MEMBRESÍA en el negocio del contexto.
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [],
        administradores: [],
        rol: 'SUPERADMIN',
      });
      await expect(
        service.configurarBarberoPorId(1, {} as any),
      ).rejects.toThrow('El usuario no es administrador de esta barbería');
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // actualizarComision
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('actualizarComision', () => {
    it('debe actualizar comisión exitosamente', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ id: 1, negocioId: 1 }],
      });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({
        id: 2,
        rol: 'PERSONAL',
      });
      barberosRepository.actualizarComision.mockResolvedValue({});

      await service.actualizarComision(
        1,
        { porcentajeComision: 60 },
        {
          email: 'admin@b.com',
        },
      );
      expect(authorizationService.verificarPermisosComision).toHaveBeenCalled();
      expect(barberosRepository.actualizarComision).toHaveBeenCalledWith(1, 60);
    });

    it('debe lanzar si usuario no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(
        service.actualizarComision(1, {} as any, { email: 'admin@b.com' }),
      ).rejects.toThrow('El usuario no existe');
    });

    it('debe lanzar si usuario no es barbero', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [],
      });
      await expect(
        service.actualizarComision(1, {} as any, { email: 'admin@b.com' }),
      ).rejects.toThrow('El usuario no es un barbero');
    });

    it('debe lanzar si usuario autenticado no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ id: 1, negocioId: 1 }],
      });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      await expect(
        service.actualizarComision(1, {} as any, { email: 'admin@b.com' }),
      ).rejects.toThrow('El usuario autenticado no existe');
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // obtenerBarberosCatalogo
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('obtenerBarberosCatalogo', () => {
    it('debe retornar barberos en formato catálogo', async () => {
      barberosRepository.obtenerBarberosCatalogo.mockResolvedValue([
        {
          id: 1,
          telefono: '300',
          fotoUrl: '/foto.jpg',
          usuario: { nombre: 'Juan', apellido: 'P' },
        },
      ]);
      const result = await service.obtenerBarberosCatalogo({});
      expect(result).toHaveLength(1);
      expect(result[0].nombre).toBe('Juan');
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // obtenerBarberosGestion â€” branches
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('obtenerBarberosGestion', () => {
    it('debe mapear barbero con administrador ACTIVO', async () => {
      barberosRepository.obtenerBarberosGestion.mockResolvedValue([
        {
          id: 1,
          telefono: '300',
          porcentajeComision: 40,
          estado: 'ACTIVO',
          fotoUrl: null,
          usuario: {
            id: 10,
            nombre: 'Carlos',
            apellido: 'G',
            email: 'c@c.com',
            rol: 'PERSONAL',
            estado: 'ACTIVO',
            administradores: [{ estado: 'ACTIVO', negocioId: 1 }],
          },
        },
      ]);
      const result = await service.obtenerBarberosGestion();
      expect(result[0].esAdministrador).toBe(true);
      expect(result[0].estadoAdmin).toBe('ACTIVO');
    });

    it('debe mapear barbero SIN administrador (null)', async () => {
      barberosRepository.obtenerBarberosGestion.mockResolvedValue([
        {
          id: 1,
          telefono: '300',
          porcentajeComision: 40,
          estado: 'ACTIVO',
          fotoUrl: null,
          usuario: {
            id: 10,
            nombre: 'Carlos',
            apellido: 'G',
            email: 'c@c.com',
            rol: 'PERSONAL',
            estado: 'ACTIVO',
            administradores: [],
          },
        },
      ]);
      const result = await service.obtenerBarberosGestion();
      expect(result[0].esAdministrador).toBe(false);
      expect(result[0].estadoAdmin).toBeUndefined();
    });

    it('debe mapear barbero que es SUPERADMIN de SU barbería (membresía)', async () => {
      barberosRepository.obtenerBarberosGestion.mockResolvedValue([
        {
          id: 1,
          telefono: '300',
          porcentajeComision: 50,
          estado: 'ACTIVO',
          fotoUrl: null,
          usuario: {
            id: 10,
            nombre: 'Super',
            apellido: 'Admin',
            email: 's@s.com',
            rol: 'PERSONAL',
            estado: 'ACTIVO',
            // La MEMBRESÍA en este negocio es la que da el carácter SUPERADMIN.
            administradores: [
              { negocioId: 1, estado: 'ACTIVO', superadmin: true },
            ],
          },
        },
      ]);
      const result = await service.obtenerBarberosGestion();
      expect(result[0].esSuperAdmin).toBe(true);
    });

    it('NO marca esSuperAdmin por el rol global de la persona', async () => {
      barberosRepository.obtenerBarberosGestion.mockResolvedValue([
        {
          id: 1,
          telefono: '300',
          porcentajeComision: 50,
          estado: 'ACTIVO',
          fotoUrl: null,
          usuario: {
            id: 10,
            nombre: 'Super',
            apellido: 'Admin',
            email: 's@s.com',
            rol: 'SUPERADMIN',
            estado: 'ACTIVO',
            administradores: [],
          },
        },
      ]);
      const result = await service.obtenerBarberosGestion();
      expect(result[0].esSuperAdmin).toBe(false);
    });

    it('debe mapear barbero con administrador INACTIVO', async () => {
      barberosRepository.obtenerBarberosGestion.mockResolvedValue([
        {
          id: 1,
          telefono: '300',
          porcentajeComision: 40,
          estado: 'ACTIVO',
          fotoUrl: null,
          usuario: {
            id: 10,
            nombre: 'C',
            apellido: 'G',
            email: 'c@c.com',
            rol: 'PERSONAL',
            estado: 'ACTIVO',
            administradores: [{ estado: 'INACTIVO', negocioId: 1 }],
          },
        },
      ]);
      const result = await service.obtenerBarberosGestion();
      expect(result[0].esAdministrador).toBe(false);
      expect(result[0].estadoAdmin).toBe('INACTIVO');
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // subirFotoBarbero â€” branches
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('subirFotoBarbero', () => {
    it('debe lanzar si no se proporciona archivo', async () => {
      await expect(service.subirFotoBarbero(1, null as any)).rejects.toThrow(
        'No se ha proporcionado ningún archivo de imagen',
      );
    });

    it('debe lanzar si el barbero no existe (y limpiar archivo)', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);
      await expect(
        service.subirFotoBarbero(1, {
          path: '/tmp/a.jpg',
          filename: 'a.jpg',
        } as any),
      ).rejects.toThrow('perfil de barbero');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/a.jpg');
    });

    it('debe subir foto eliminando la anterior', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: '/uploads/barberos/old.jpg',
      });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.subirFotoBarbero(1, {
        path: '/tmp/a.jpg',
        filename: 'new.jpg',
      } as any);
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(result.fotoUrl).toBe('/uploads/barberos/new.jpg');
    });

    it('debe subir foto sin eliminar anterior si no tiene foto previa', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: null,
      });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.subirFotoBarbero(1, {
        path: '/tmp/a.jpg',
        filename: 'new.jpg',
      } as any);
      expect(result.fotoUrl).toBe('/uploads/barberos/new.jpg');
    });

    it('debe subir foto sin eliminar anterior si fotoUrl es externa', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: 'https://example.com/old.jpg',
      });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.subirFotoBarbero(1, {
        path: '/tmp/a.jpg',
        filename: 'new.jpg',
      } as any);
      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(result.fotoUrl).toBe('/uploads/barberos/new.jpg');
    });

    it('debe verificar permisos si hay usuario autenticado', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: null,
      });
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1 });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      await service.subirFotoBarbero(
        1,
        { path: '/tmp/a.jpg', filename: 'x.jpg' } as any,
        { email: 'auth@b.com' },
      );
      expect(authorizationService.verificarPermisosEdicion).toHaveBeenCalled();
    });

    it('debe limpiar archivo si falla la autorización', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: null,
      });
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1 });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 2 });
      authorizationService.verificarPermisosEdicion.mockImplementation(() => {
        throw new Error('Forbidden');
      });

      await expect(
        service.subirFotoBarbero(
          1,
          { path: '/tmp/a.jpg', filename: 'x.jpg' } as any,
          { email: 'auth@b.com' },
        ),
      ).rejects.toThrow('Forbidden');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/a.jpg');
    });

    it('debe omitir la verificación de permisos si no se resuelve el usuario autenticado', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: null,
      });
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.subirFotoBarbero(
        1,
        { path: '/tmp/a.jpg', filename: 'x.jpg' } as any,
        { email: 'auth@b.com' },
      );

      expect(
        authorizationService.verificarPermisosEdicion,
      ).not.toHaveBeenCalled();
      expect(result.fotoUrl).toBe('/uploads/barberos/x.jpg');
    });

    it('debe omitir el borrado de la foto anterior cuando el archivo no existe en disco', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: '/uploads/barberos/old.jpg',
      });
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.subirFotoBarbero(1, {
        path: '/tmp/a.jpg',
        filename: 'new.jpg',
      } as any);

      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(result.fotoUrl).toBe('/uploads/barberos/new.jpg');
    });

    it('debe registrar un warning y continuar si falla el borrado de la foto anterior', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: '/uploads/barberos/old.jpg',
      });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {
        throw new Error('EACCES');
      });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.subirFotoBarbero(1, {
        path: '/tmp/a.jpg',
        filename: 'new.jpg',
      } as any);

      expect(warnSpy).toHaveBeenCalled();
      expect(result.fotoUrl).toBe('/uploads/barberos/new.jpg');
      warnSpy.mockRestore();
      (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);
    });
  });

  describe('subirMiFoto', () => {
    it('debe lanzar BadRequestException si no se envía archivo', async () => {
      await expect(service.subirMiFoto({ id: 1 }, undefined)).rejects.toThrow(
        'Debe seleccionar un archivo de imagen',
      );
    });

    it('debe lanzar BadRequestException si el usuario autenticado no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(
        service.subirMiFoto({ id: 99 }, { filename: 'foto.jpg' } as any),
      ).rejects.toThrow('Usuario no encontrado');
    });

    it('debe buscar por email si no viene id numérico', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      await expect(
        service.subirMiFoto(
          { email: 'desconocido@test.com' },
          { filename: 'foto.jpg' } as any,
        ),
      ).rejects.toThrow('Usuario no encontrado');
    });

    it('debe llamar a subirFotoBarbero cuando el usuario existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 7 });
      jest.spyOn(service, 'subirFotoBarbero').mockResolvedValue({
        mensaje: 'ok',
        fotoUrl: '/uploads/barberos/foto.jpg',
      });

      const file = { filename: 'foto.jpg' } as any;
      const res = await service.subirMiFoto({ id: 7 }, file);

      expect(service.subirFotoBarbero).toHaveBeenCalledWith(7, file);
      expect(res.fotoUrl).toBe('/uploads/barberos/foto.jpg');
    });
  });

  describe('eliminarMiFoto', () => {
    it('debe lanzar BadRequestException si el usuario no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(service.eliminarMiFoto({ id: 99 })).rejects.toThrow(
        'Usuario no encontrado',
      );
    });

    it('debe llamar a eliminarFotoBarbero cuando el usuario existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 8 });
      jest.spyOn(service, 'eliminarFotoBarbero').mockResolvedValue({
        mensaje: 'Foto eliminada',
        fotoUrl: null,
      });

      const res = await service.eliminarMiFoto({ id: 8 });

      expect(service.eliminarFotoBarbero).toHaveBeenCalledWith(8);
      expect(res.mensaje).toBe('Foto eliminada');
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // eliminarFotoBarbero â€” branches
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('eliminarFotoBarbero', () => {
    it('debe lanzar si barbero no existe', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);
      await expect(service.eliminarFotoBarbero(1)).rejects.toThrow(
        'perfil de barbero',
      );
    });

    it('debe eliminar foto del disco y de la DB', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: '/uploads/barberos/old.jpg',
      });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.eliminarFotoBarbero(1);
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(result.fotoUrl).toBeNull();
    });

    it('debe eliminar de DB sin borrar del disco si fotoUrl es externa', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: 'https://cdn.example.com/a.jpg',
      });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.eliminarFotoBarbero(1);
      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(result.fotoUrl).toBeNull();
    });

    it('debe manejar gracefully si unlinkSync falla', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: '/uploads/barberos/old.jpg',
      });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {
        throw new Error('EPERM');
      });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.eliminarFotoBarbero(1);
      expect(result.fotoUrl).toBeNull();
    });

    it('debe no intentar borrar archivo si existsSync retorna false', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        fotoUrl: '/uploads/barberos/old.jpg',
      });
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      await service.eliminarFotoBarbero(1);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // cambiarEstadoBarbero â€” all branches
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('cambiarEstadoBarbero', () => {
    it('debe lanzar si usuario no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(
        service.cambiarEstadoBarbero(1, { estado: 'INACTIVO' } as any, {
          sub: 'x',
        }),
      ).rejects.toThrow('El usuario no existe');
    });

    it('debe lanzar si usuario no es barbero', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [],
      });
      await expect(
        service.cambiarEstadoBarbero(1, { estado: 'INACTIVO' } as any, {
          sub: 'x',
        }),
      ).rejects.toThrow('no es un barbero');
    });

    it('debe lanzar si usuario autenticado no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ negocioId: 1 }],
      });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      await expect(
        service.cambiarEstadoBarbero(1, { estado: 'INACTIVO' } as any, {
          email: 'auth@b.com',
        }),
      ).rejects.toThrow('usuario autenticado no existe');
    });

    it('debe ACTIVAR barbero', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ estado: 'INACTIVO', negocioId: 1 }],
        administradores: [],
        rol: 'PERSONAL',
      });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(
        1,
        { estado: EstadoUsuario.ACTIVO },
        { email: 'auth@b.com' },
      );
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(
        1,
        EstadoUsuario.ACTIVO,
      );
    });

    it('debe INACTIVAR barbero puro (bloquear cuenta global)', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ estado: 'ACTIVO', negocioId: 1 }],
        administradores: [],
        rol: 'PERSONAL',
      });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(
        1,
        { estado: EstadoUsuario.INACTIVO },
        { email: 'auth@b.com' },
      );
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(
        1,
        'INACTIVO',
      );
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(
        1,
        EstadoUsuario.INACTIVO,
      );
    });

    it('debe INACTIVAR barbero que es admin ACTIVO (NO bloquear cuenta global)', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ estado: 'ACTIVO', negocioId: 1 }],
        administradores: [{ estado: 'ACTIVO', negocioId: 1 }],
        rol: 'PERSONAL',
      });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(
        1,
        { estado: EstadoUsuario.INACTIVO },
        { email: 'auth@b.com' },
      );
      expect(usuariosRepository.actualizarEstadoUsuario).not.toHaveBeenCalled();
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(
        1,
        EstadoUsuario.INACTIVO,
      );
    });

    it('debe INACTIVAR barbero que es SUPERADMIN (NO bloquear cuenta global)', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ estado: 'ACTIVO', negocioId: 1 }],
        // Membresía SUPERADMIN de ESTE negocio: no se bloquea la cuenta global.
        administradores: [{ negocioId: 1, estado: 'ACTIVO', superadmin: true }],
        rol: 'PERSONAL',
      });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(
        1,
        { estado: EstadoUsuario.INACTIVO },
        { email: 'auth@b.com' },
      );
      expect(usuariosRepository.actualizarEstadoUsuario).not.toHaveBeenCalled();
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(
        1,
        EstadoUsuario.INACTIVO,
      );
    });

    it('debe INACTIVAR barbero con rol ADMINISTRADOR (NO bloquear cuenta global)', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ estado: 'ACTIVO', negocioId: 1 }],
        administradores: [{ estado: 'ACTIVO', negocioId: 1 }],
        rol: 'PERSONAL',
      });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(
        1,
        { estado: EstadoUsuario.INACTIVO },
        { email: 'auth@b.com' },
      );
      expect(usuariosRepository.actualizarEstadoUsuario).not.toHaveBeenCalled();
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(
        1,
        EstadoUsuario.INACTIVO,
      );
    });

    it('no debe bloquear la cuenta global al desactivar barbero si tiene membresía activa en otra sede', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [
          { estado: 'ACTIVO', negocioId: 1 },
          { estado: 'ACTIVO', negocioId: 2 },
        ],
        administradores: [],
        rol: 'PERSONAL',
      });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(
        1,
        { estado: EstadoUsuario.INACTIVO },
        { email: 'auth@b.com' },
      );
      expect(usuariosRepository.actualizarEstadoUsuario).not.toHaveBeenCalled();
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(
        1,
        EstadoUsuario.INACTIVO,
      );
    });

    it('debe bloquear la cuenta global si se inactiva barbero y no tiene más membresías activas', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: 1,
        barberos: [{ estado: 'ACTIVO', negocioId: 1 }],
        administradores: [],
        rol: 'PERSONAL',
      });
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(
        1,
        { estado: EstadoUsuario.INACTIVO },
        { email: 'auth@b.com' },
      );
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(
        1,
        EstadoUsuario.INACTIVO,
      );
    });
  });
});

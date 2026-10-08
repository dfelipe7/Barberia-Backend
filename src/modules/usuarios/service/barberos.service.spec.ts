import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { BarberosService } from './barberos.service';
import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberosRepository } from '../repository/barberos.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { FiltroBarberosDto } from '../dto/dto-peticion/filtro-barberos.dto';

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
  let keycloakService: any;
  let usuariosRepository: any;
  let barberosRepository: any;
  let authorizationService: any;

  beforeEach(async () => {
    const mockKeycloakService = {
      crearUsuario: jest.fn(),
      asignarRol: jest.fn(),
      quitarRol: jest.fn(),
      cambiarEstadoUsuario: jest.fn(),
    };

    const mockUsuariosRepository = {
      obtenerUsuarioPorId: jest.fn(),
      obtenerUsuarioPorKeycloakId: jest.fn(),
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
        { provide: KeycloakService, useValue: mockKeycloakService },
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
        { provide: BarberosRepository, useValue: mockBarberosRepository },
        { provide: UsuariosAuthorizationService, useValue: mockAuthorizationService },
      ],
    }).compile();

    service = module.get<BarberosService>(BarberosService);
    keycloakService = module.get(KeycloakService);
    usuariosRepository = module.get(UsuariosRepository);
    barberosRepository = module.get(BarberosRepository);
    authorizationService = module.get(UsuariosAuthorizationService);
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────
  // crearBarbero
  // ───────────────────────────────────────
  describe('crearBarbero', () => {
    it('debe crear barbero correctamente', async () => {
      const dto: any = { email: 'b@b.com', password: '123', nombre: 'B', apellido: 'P', telefono: '300', porcentajeComision: 50 };
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      keycloakService.crearUsuario.mockResolvedValue('kc-id');
      usuariosRepository.crearUsuario.mockResolvedValue({ id: 1 });
      barberosRepository.crearBarberoNuevo.mockResolvedValue({ id: 1 });

      const result = await service.crearBarbero(dto);
      expect(result.mensaje).toContain('creado correctamente');
      expect(keycloakService.asignarRol).toHaveBeenCalledWith('kc-id', 'BARBERO');
    });

    it('debe lanzar ConflictException si el email ya existe', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({ id: 1 });
      await expect(service.crearBarbero({ email: 'b@b.com' } as any)).rejects.toThrow(ConflictException);
    });

    it('debe lanzar ConflictException si falla el guardado en DB', async () => {
      usuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      keycloakService.crearUsuario.mockResolvedValue('kc-id');
      usuariosRepository.crearUsuario.mockRejectedValue(new Error('DB error'));

      await expect(service.crearBarbero({ email: 'b@b.com', password: '1', nombre: 'a', apellido: 'b' } as any)).rejects.toThrow(ConflictException);
    });
  });

  // ───────────────────────────────────────
  // configurarBarbero
  // ───────────────────────────────────────
  describe('configurarBarbero', () => {
    it('debe crear perfil de barbero nuevo', async () => {
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 1, keycloakId: 'kc', barbero: null });
      barberosRepository.crearPerfilBarbero.mockResolvedValue({ id: 1 });

      const result = await service.configurarBarbero('kc', { telefono: '300', porcentajeComision: 50 } as any);
      expect(keycloakService.asignarRol).toHaveBeenCalledWith('kc', 'BARBERO');
      expect(barberosRepository.crearPerfilBarbero).toHaveBeenCalled();
    });

    it('debe lanzar ConflictException si el usuario no existe', async () => {
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(null);
      await expect(service.configurarBarbero('kc', {} as any)).rejects.toThrow('El usuario no existe');
    });

    it('debe lanzar ConflictException si ya es barbero ACTIVO', async () => {
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 1, barbero: { estado: 'ACTIVO' } });
      await expect(service.configurarBarbero('kc', {} as any)).rejects.toThrow('ya está configurado como barbero');
    });

    it('debe reactivar barbero INACTIVO', async () => {
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 1, keycloakId: 'kc', barbero: { estado: 'INACTIVO' } });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      await service.configurarBarbero('kc', { telefono: '300', porcentajeComision: 50 } as any);
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(1, 'ACTIVO');
    });
  });

  // ───────────────────────────────────────
  // configurarBarberoPorId
  // ───────────────────────────────────────
  describe('configurarBarberoPorId', () => {
    it('debe crear perfil de barbero para admin', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, keycloakId: 'kc', barbero: null, administrador: { estado: 'ACTIVO' }, rol: 'ADMINISTRADOR' });
      barberosRepository.crearPerfilBarbero.mockResolvedValue({ id: 1 });

      await service.configurarBarberoPorId(1, { telefono: '300', porcentajeComision: 50 } as any);
      expect(keycloakService.asignarRol).toHaveBeenCalledWith('kc', 'BARBERO');
    });

    it('debe lanzar ConflictException si el usuario no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(service.configurarBarberoPorId(1, {} as any)).rejects.toThrow('El usuario no existe');
    });

    it('debe lanzar ConflictException si ya es barbero ACTIVO', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, barbero: { estado: 'ACTIVO' } });
      await expect(service.configurarBarberoPorId(1, {} as any)).rejects.toThrow('ya está configurado como barbero');
    });

    it('debe reactivar barbero INACTIVO por id', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, keycloakId: 'kc', barbero: { estado: 'INACTIVO' } });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});
      await service.configurarBarberoPorId(1, { telefono: '300', porcentajeComision: 50 } as any);
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(1, 'ACTIVO');
    });

    it('debe lanzar ConflictException si usuario no es admin ni superadmin', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, keycloakId: 'kc', barbero: null, administrador: null, rol: 'BARBERO' });
      await expect(service.configurarBarberoPorId(1, {} as any)).rejects.toThrow('El usuario no es un administrador ni superadmin');
    });
  });

  // ───────────────────────────────────────
  // actualizarComision
  // ───────────────────────────────────────
  describe('actualizarComision', () => {
    it('debe actualizar comisión exitosamente', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, barbero: { id: 1 } });
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 2, rol: 'ADMINISTRADOR' });
      barberosRepository.actualizarComision.mockResolvedValue({});

      await service.actualizarComision(1, { porcentajeComision: 60 } as any, { sub: 'kc-uuid' });
      expect(authorizationService.verificarPermisosComision).toHaveBeenCalled();
      expect(barberosRepository.actualizarComision).toHaveBeenCalledWith(1, 60);
    });

    it('debe lanzar si usuario no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(service.actualizarComision(1, {} as any, { sub: 'x' })).rejects.toThrow('El usuario no existe');
    });

    it('debe lanzar si usuario no es barbero', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, barbero: null });
      await expect(service.actualizarComision(1, {} as any, { sub: 'x' })).rejects.toThrow('El usuario no es un barbero');
    });

    it('debe lanzar si usuario autenticado no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, barbero: { id: 1 } });
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(null);
      await expect(service.actualizarComision(1, {} as any, { sub: 'x' })).rejects.toThrow('El usuario autenticado no existe');
    });
  });

  // ───────────────────────────────────────
  // obtenerBarberosCatalogo
  // ───────────────────────────────────────
  describe('obtenerBarberosCatalogo', () => {
    it('debe retornar barberos en formato catálogo', async () => {
      barberosRepository.obtenerBarberosCatalogo.mockResolvedValue([
        { id: 1, telefono: '300', fotoUrl: '/foto.jpg', usuario: { nombre: 'Juan', apellido: 'P' } },
      ]);
      const result = await service.obtenerBarberosCatalogo({} as FiltroBarberosDto);
      expect(result).toHaveLength(1);
      expect(result[0].nombre).toBe('Juan');
    });
  });

  // ───────────────────────────────────────
  // obtenerBarberosGestion — branches
  // ───────────────────────────────────────
  describe('obtenerBarberosGestion', () => {
    it('debe mapear barbero con administrador ACTIVO', async () => {
      barberosRepository.obtenerBarberosGestion.mockResolvedValue([{
        id: 1, telefono: '300', porcentajeComision: 40, estado: 'ACTIVO', fotoUrl: null,
        usuario: { id: 10, nombre: 'Carlos', apellido: 'G', email: 'c@c.com', rol: 'BARBERO', estado: 'ACTIVO', administrador: { estado: 'ACTIVO' } },
      }]);
      const result = await service.obtenerBarberosGestion();
      expect(result[0].esAdministrador).toBe(true);
      expect(result[0].estadoAdmin).toBe('ACTIVO');
    });

    it('debe mapear barbero SIN administrador (null)', async () => {
      barberosRepository.obtenerBarberosGestion.mockResolvedValue([{
        id: 1, telefono: '300', porcentajeComision: 40, estado: 'ACTIVO', fotoUrl: null,
        usuario: { id: 10, nombre: 'Carlos', apellido: 'G', email: 'c@c.com', rol: 'BARBERO', estado: 'ACTIVO', administrador: null },
      }]);
      const result = await service.obtenerBarberosGestion();
      expect(result[0].esAdministrador).toBe(false);
      expect(result[0].estadoAdmin).toBeUndefined();
    });

    it('debe mapear barbero que es SUPERADMIN', async () => {
      barberosRepository.obtenerBarberosGestion.mockResolvedValue([{
        id: 1, telefono: '300', porcentajeComision: 50, estado: 'ACTIVO', fotoUrl: null,
        usuario: { id: 10, nombre: 'Super', apellido: 'Admin', email: 's@s.com', rol: 'SUPERADMIN', estado: 'ACTIVO', administrador: null },
      }]);
      const result = await service.obtenerBarberosGestion();
      expect(result[0].esSuperAdmin).toBe(true);
    });

    it('debe mapear barbero con administrador INACTIVO', async () => {
      barberosRepository.obtenerBarberosGestion.mockResolvedValue([{
        id: 1, telefono: '300', porcentajeComision: 40, estado: 'ACTIVO', fotoUrl: null,
        usuario: { id: 10, nombre: 'C', apellido: 'G', email: 'c@c.com', rol: 'BARBERO', estado: 'ACTIVO', administrador: { estado: 'INACTIVO' } },
      }]);
      const result = await service.obtenerBarberosGestion();
      expect(result[0].esAdministrador).toBe(false);
      expect(result[0].estadoAdmin).toBe('INACTIVO');
    });
  });

  // ───────────────────────────────────────
  // subirFotoBarbero — branches
  // ───────────────────────────────────────
  describe('subirFotoBarbero', () => {
    it('debe lanzar si no se proporciona archivo', async () => {
      await expect(service.subirFotoBarbero(1, null as any)).rejects.toThrow('No se ha proporcionado ningún archivo de imagen');
    });

    it('debe lanzar si el barbero no existe (y limpiar archivo)', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);
      await expect(service.subirFotoBarbero(1, { path: '/tmp/a.jpg', filename: 'a.jpg' } as any)).rejects.toThrow('perfil de barbero');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/a.jpg');
    });

    it('debe subir foto eliminando la anterior', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({ fotoUrl: '/uploads/barberos/old.jpg' });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.subirFotoBarbero(1, { path: '/tmp/a.jpg', filename: 'new.jpg' } as any);
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(result.fotoUrl).toBe('/uploads/barberos/new.jpg');
    });

    it('debe subir foto sin eliminar anterior si no tiene foto previa', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({ fotoUrl: null });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.subirFotoBarbero(1, { path: '/tmp/a.jpg', filename: 'new.jpg' } as any);
      expect(result.fotoUrl).toBe('/uploads/barberos/new.jpg');
    });

    it('debe subir foto sin eliminar anterior si fotoUrl es externa', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({ fotoUrl: 'https://example.com/old.jpg' });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.subirFotoBarbero(1, { path: '/tmp/a.jpg', filename: 'new.jpg' } as any);
      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(result.fotoUrl).toBe('/uploads/barberos/new.jpg');
    });

    it('debe verificar permisos si hay usuario autenticado', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({ fotoUrl: null });
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1 });
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      await service.subirFotoBarbero(1, { path: '/tmp/a.jpg', filename: 'x.jpg' } as any, { sub: 'kc' });
      expect(authorizationService.verificarPermisosEdicion).toHaveBeenCalled();
    });

    it('debe limpiar archivo si falla la autorización', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({ fotoUrl: null });
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1 });
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 2 });
      authorizationService.verificarPermisosEdicion.mockImplementation(() => { throw new Error('Forbidden'); });

      await expect(service.subirFotoBarbero(1, { path: '/tmp/a.jpg', filename: 'x.jpg' } as any, { sub: 'kc' })).rejects.toThrow('Forbidden');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/a.jpg');
    });
  });

  // ───────────────────────────────────────
  // eliminarFotoBarbero — branches
  // ───────────────────────────────────────
  describe('eliminarFotoBarbero', () => {
    it('debe lanzar si barbero no existe', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);
      await expect(service.eliminarFotoBarbero(1)).rejects.toThrow('perfil de barbero');
    });

    it('debe eliminar foto del disco y de la DB', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({ fotoUrl: '/uploads/barberos/old.jpg' });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.eliminarFotoBarbero(1);
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(result.fotoUrl).toBeNull();
    });

    it('debe eliminar de DB sin borrar del disco si fotoUrl es externa', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({ fotoUrl: 'https://cdn.example.com/a.jpg' });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.eliminarFotoBarbero(1);
      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(result.fotoUrl).toBeNull();
    });

    it('debe manejar gracefully si unlinkSync falla', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({ fotoUrl: '/uploads/barberos/old.jpg' });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockImplementation(() => { throw new Error('EPERM'); });
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      const result = await service.eliminarFotoBarbero(1);
      expect(result.fotoUrl).toBeNull();
    });

    it('debe no intentar borrar archivo si existsSync retorna false', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({ fotoUrl: '/uploads/barberos/old.jpg' });
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      barberosRepository.actualizarPerfilBarbero.mockResolvedValue({});

      await service.eliminarFotoBarbero(1);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────
  // cambiarEstadoBarbero — all branches
  // ───────────────────────────────────────
  describe('cambiarEstadoBarbero', () => {
    it('debe lanzar si usuario no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(service.cambiarEstadoBarbero(1, { estado: 'INACTIVO' } as any, { sub: 'x' })).rejects.toThrow('El usuario no existe');
    });

    it('debe lanzar si usuario no es barbero', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, barbero: null });
      await expect(service.cambiarEstadoBarbero(1, { estado: 'INACTIVO' } as any, { sub: 'x' })).rejects.toThrow('no es un barbero');
    });

    it('debe lanzar si usuario autenticado no existe', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, barbero: {} });
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue(null);
      await expect(service.cambiarEstadoBarbero(1, { estado: 'INACTIVO' } as any, { sub: 'x' })).rejects.toThrow('usuario autenticado no existe');
    });

    it('debe ACTIVAR barbero (asignar rol)', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, keycloakId: 'kc', barbero: { estado: 'INACTIVO' }, administrador: null, rol: 'BARBERO' });
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(1, { estado: EstadoUsuario.ACTIVO } as any, { sub: 'x' });
      expect(keycloakService.asignarRol).toHaveBeenCalledWith('kc', 'BARBERO');
      expect(keycloakService.quitarRol).not.toHaveBeenCalled();
    });

    it('debe INACTIVAR barbero puro (bloquear cuenta global)', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, keycloakId: 'kc', barbero: { estado: 'ACTIVO' }, administrador: null, rol: 'BARBERO' });
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(1, { estado: EstadoUsuario.INACTIVO } as any, { sub: 'x' });
      expect(keycloakService.quitarRol).toHaveBeenCalledWith('kc', 'BARBERO');
      expect(keycloakService.cambiarEstadoUsuario).toHaveBeenCalledWith('kc', false);
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(1, 'INACTIVO');
    });

    it('debe INACTIVAR barbero que es admin ACTIVO (NO bloquear cuenta global)', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, keycloakId: 'kc', barbero: { estado: 'ACTIVO' }, administrador: { estado: 'ACTIVO' }, rol: 'BARBERO' });
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(1, { estado: EstadoUsuario.INACTIVO } as any, { sub: 'x' });
      expect(keycloakService.quitarRol).toHaveBeenCalledWith('kc', 'BARBERO');
      expect(keycloakService.cambiarEstadoUsuario).not.toHaveBeenCalled();
    });

    it('debe INACTIVAR barbero que es SUPERADMIN (NO bloquear cuenta global)', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, keycloakId: 'kc', barbero: { estado: 'ACTIVO' }, administrador: null, rol: 'SUPERADMIN' });
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(1, { estado: EstadoUsuario.INACTIVO } as any, { sub: 'x' });
      expect(keycloakService.quitarRol).toHaveBeenCalledWith('kc', 'BARBERO');
      expect(keycloakService.cambiarEstadoUsuario).not.toHaveBeenCalled();
    });

    it('debe INACTIVAR barbero con rol ADMINISTRADOR (NO bloquear cuenta global)', async () => {
      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 1, keycloakId: 'kc', barbero: { estado: 'ACTIVO' }, administrador: null, rol: 'ADMINISTRADOR' });
      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 2 });
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({});

      await service.cambiarEstadoBarbero(1, { estado: EstadoUsuario.INACTIVO } as any, { sub: 'x' });
      expect(keycloakService.quitarRol).toHaveBeenCalledWith('kc', 'BARBERO');
      expect(keycloakService.cambiarEstadoUsuario).not.toHaveBeenCalled();
    });
  });
});

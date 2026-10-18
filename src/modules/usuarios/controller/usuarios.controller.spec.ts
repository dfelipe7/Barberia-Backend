import { Test, TestingModule } from '@nestjs/testing';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from '../service/usuarios.service';
import { BarberosService } from '../service/barberos.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

const mockUsuariosService = {
  sincronizarSuperadmin: jest.fn(),
  obtenerMiPerfil: jest.fn(),
  obtenerUsuarioPorId: jest.fn(),
  actualizarUsuario: jest.fn(),
  cambiarEstadoUsuario: jest.fn(),
};

const mockBarberosService = {
  configurarBarbero: jest.fn(),
  configurarBarberoPorId: jest.fn(),
};

describe('UsuariosController', () => {
  let controller: UsuariosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsuariosController],
      providers: [
        { provide: UsuariosService, useValue: mockUsuariosService },
        { provide: BarberosService, useValue: mockBarberosService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsuariosController>(UsuariosController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('configurarMiPerfilComoBarbero', () => {
    it('should call configurarBarbero with user sub', async () => {
      const req = { user: { sub: '1' } };
      const dto: any = { telefono: '300', porcentajeComision: 50 };
      mockBarberosService.configurarBarbero.mockResolvedValue({ id: 1 });
      const result = await controller.configurarMiPerfilComoBarbero(req, dto);
      expect(mockBarberosService.configurarBarbero).toHaveBeenCalledWith(
        '1',
        dto,
      );
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('sincronizarSuperadmin', () => {
    it('should call sincronizarSuperadmin', async () => {
      mockUsuariosService.sincronizarSuperadmin.mockResolvedValue([
        { mensaje: 'ok' },
      ]);
      const result = await controller.sincronizarSuperadmin();
      expect(mockUsuariosService.sincronizarSuperadmin).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('configurarBarberoPorId', () => {
    it('should call configurarBarberoPorId with numeric id', async () => {
      const dto: any = { telefono: '300', porcentajeComision: 50 };
      mockBarberosService.configurarBarberoPorId.mockResolvedValue({ id: 2 });
      const result = await controller.configurarBarberoPorId('2', dto);
      expect(mockBarberosService.configurarBarberoPorId).toHaveBeenCalledWith(
        2,
        dto,
      );
      expect(result).toEqual({ id: 2 });
    });
  });

  describe('obtenerMiPerfil', () => {
    it('should call obtenerMiPerfil with user from request', async () => {
      const req = { user: { sub: 'kc-uuid' } };
      const perfil = { id: 1, nombre: 'Juan' };
      mockUsuariosService.obtenerMiPerfil.mockResolvedValue(perfil);
      const result = await controller.obtenerMiPerfil(req);
      expect(mockUsuariosService.obtenerMiPerfil).toHaveBeenCalledWith(
        req.user,
      );
      expect(result).toEqual(perfil);
    });
  });

  describe('obtenerUsuarioPorId', () => {
    it('should call obtenerUsuarioPorId with numeric id', async () => {
      const req = { user: { sub: 'kc-uuid' } };
      mockUsuariosService.obtenerUsuarioPorId.mockResolvedValue({ id: 5 });
      const result = await controller.obtenerUsuarioPorId('5', req);
      expect(mockUsuariosService.obtenerUsuarioPorId).toHaveBeenCalledWith(
        5,
        req.user,
      );
      expect(result).toEqual({ id: 5 });
    });
  });

  describe('actualizarUsuario', () => {
    it('should call actualizarUsuario with numeric id and dto', async () => {
      const req = { user: { sub: 'kc-uuid' } };
      const dto: any = { nombre: 'Carlos' };
      mockUsuariosService.actualizarUsuario.mockResolvedValue({
        id: 3,
        nombre: 'Carlos',
      });
      const result: any = await controller.actualizarUsuario('3', dto, req);
      expect(mockUsuariosService.actualizarUsuario).toHaveBeenCalledWith(
        3,
        dto,
        req.user,
      );
      expect(result.nombre).toBe('Carlos');
    });
  });

  describe('cambiarEstadoUsuario', () => {
    it('should call cambiarEstadoUsuario with numeric id', async () => {
      const req = { user: { sub: 'kc-uuid' } };
      const dto: any = { estado: 'INACTIVO' };
      mockUsuariosService.cambiarEstadoUsuario.mockResolvedValue({
        estado: 'INACTIVO',
      });
      const result = await controller.cambiarEstadoUsuario('4', dto, req);
      expect(mockUsuariosService.cambiarEstadoUsuario).toHaveBeenCalledWith(
        4,
        dto,
        req.user,
      );
      expect(result.estado).toBe('INACTIVO');
    });
  });
});

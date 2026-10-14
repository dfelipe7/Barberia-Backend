import { Test, TestingModule } from '@nestjs/testing';
import { BarberosController } from './barberos.controller';
import { BarberosService } from '../service/barberos.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { BadRequestException } from '@nestjs/common';

const mockBarberosService = {
  crearBarbero: jest.fn(),
  obtenerBarberosGestion: jest.fn(),
  obtenerBarberosCatalogo: jest.fn(),
  actualizarComision: jest.fn(),
  cambiarEstadoBarbero: jest.fn(),
  subirFotoBarbero: jest.fn(),
  eliminarFotoBarbero: jest.fn(),
};

const mockUsuariosRepository = {
  obtenerUsuarioPorGoogleId: jest.fn(),
  obtenerUsuarioPorId: jest.fn(),
  obtenerUsuarioPorEmail: jest.fn(),
};

describe('BarberosController', () => {
  let controller: BarberosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BarberosController],
      providers: [
        { provide: BarberosService, useValue: mockBarberosService },
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BarberosController>(BarberosController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('crearBarbero', () => {
    it('should call barberosService.crearBarbero', async () => {
      const dto: any = { email: 'b@b.com', nombre: 'Juan', apellido: 'P', telefono: '300', porcentajeComision: 50 };
      mockBarberosService.crearBarbero.mockResolvedValue({ mensaje: 'Barbero creado correctamente' });
      const result = await controller.crearBarbero(dto);
      expect(result.mensaje).toContain('creado');
      expect(mockBarberosService.crearBarbero).toHaveBeenCalledWith(dto);
    });
  });

  describe('obtenerBarberosGestion', () => {
    it('should return gestion list', async () => {
      mockBarberosService.obtenerBarberosGestion.mockResolvedValue([{ id: 1 }]);
      const result = await controller.obtenerBarberosGestion({} as any);
      expect(result).toHaveLength(1);
    });
  });

  describe('obtenerBarberosCatalogo', () => {
    it('should return catalogo list', async () => {
      mockBarberosService.obtenerBarberosCatalogo.mockResolvedValue([{ id: 1 }]);
      const result = await controller.obtenerBarberosCatalogo({} as any);
      expect(result).toHaveLength(1);
    });
  });

  describe('actualizarComision', () => {
    it('should call actualizarComision with numeric id', async () => {
      const dto: any = { porcentajeComision: 60 };
      const req = { user: { sub: 'uuid' } };
      mockBarberosService.actualizarComision.mockResolvedValue({});
      await controller.actualizarComision('1', dto, req);
      expect(mockBarberosService.actualizarComision).toHaveBeenCalledWith(1, dto, req.user);
    });
  });

  describe('cambiarEstadoBarbero', () => {
    it('should call cambiarEstadoBarbero with numeric id', async () => {
      const dto: any = { estado: 'INACTIVO' };
      const req = { user: { sub: 'uuid' } };
      mockBarberosService.cambiarEstadoBarbero.mockResolvedValue({});
      await controller.cambiarEstadoBarbero('2', dto, req);
      expect(mockBarberosService.cambiarEstadoBarbero).toHaveBeenCalledWith(2, dto, req.user);
    });
  });

  describe('subirMiFoto', () => {
    it('should throw BadRequestException if no file', async () => {
      await expect(controller.subirMiFoto(undefined as any, { user: { sub: 'x' } })).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user not found', async () => {
      mockUsuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(controller.subirMiFoto({ filename: 'a.jpg' } as any, { user: { id: 5 } })).rejects.toThrow(BadRequestException);
    });

    it('should call subirFotoBarbero when file and user are valid', async () => {
      mockUsuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 5 });
      mockBarberosService.subirFotoBarbero.mockResolvedValue({ fotoUrl: '/uploads/foto.jpg' });
      const result = await controller.subirMiFoto({ filename: 'a.jpg' } as any, { user: { id: 5 } });
      expect(mockBarberosService.subirFotoBarbero).toHaveBeenCalledWith(5, { filename: 'a.jpg' });
      expect(result.fotoUrl).toBe('/uploads/foto.jpg');
    });
  });

  describe('eliminarMiFoto', () => {
    it('should throw BadRequestException if user not found', async () => {
      mockUsuariosRepository.obtenerUsuarioPorId.mockResolvedValue(null);
      await expect(controller.eliminarMiFoto({ user: { id: 5 } })).rejects.toThrow(BadRequestException);
    });

    it('should call eliminarFotoBarbero when user is valid', async () => {
      mockUsuariosRepository.obtenerUsuarioPorId.mockResolvedValue({ id: 5 });
      mockBarberosService.eliminarFotoBarbero.mockResolvedValue({ mensaje: 'Eliminada' });
      const result = await controller.eliminarMiFoto({ user: { id: 5 } });
      expect(mockBarberosService.eliminarFotoBarbero).toHaveBeenCalledWith(5);
      expect(result.mensaje).toBe('Eliminada');
    });
  });

  describe('subirFotoBarberoPorId', () => {
    it('should throw BadRequestException if no file', async () => {
      await expect(controller.subirFotoBarberoPorId('1', undefined as any, { user: {} })).rejects.toThrow(BadRequestException);
    });

    it('should call subirFotoBarbero with numeric id', async () => {
      mockBarberosService.subirFotoBarbero.mockResolvedValue({ fotoUrl: '/uploads/x.jpg' });
      const result = await controller.subirFotoBarberoPorId('3', { filename: 'x.jpg' } as any, { user: { sub: 'uuid' } });
      expect(mockBarberosService.subirFotoBarbero).toHaveBeenCalledWith(3, { filename: 'x.jpg' }, { sub: 'uuid' });
      expect(result.fotoUrl).toBe('/uploads/x.jpg');
    });
  });
});

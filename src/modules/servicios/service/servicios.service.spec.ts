import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { ServiciosService } from './servicios.service';
import { ServiciosRepository } from '../repository/servicios.repository';

describe('ServiciosService', () => {
  let service: ServiciosService;
  let repository: jest.Mocked<ServiciosRepository>;

  beforeEach(async () => {
    const mockRepository = {
      obtenerBarberosActivosPorIds: jest.fn(),
      obtenerServicioPorNombre: jest.fn(),
      crearServicio: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiciosService,
        { provide: ServiciosRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get<ServiciosService>(ServiciosService);
    repository = module.get(ServiciosRepository) as any;
  });

  describe('crearServicio', () => {
    it('Debe lanzar BadRequestException al intentar crear un servicio asignándole un barbero que está INACTIVO o no existe', async () => {
      const dto = {
        nombre: 'Corte Premium',
        precio: 30000,
        duracionMinutos: 45,
        barberoIds: [1, 2],
      };

      repository.obtenerServicioPorNombre.mockResolvedValue(null);
      // Simulamos que la base de datos solo encuentra a 1 barbero activo (el ID 1) y el ID 2 no existe o está inactivo.
      repository.obtenerBarberosActivosPorIds.mockResolvedValue([{ id: 1 } as any]);

      await expect(service.crearServicio(dto)).rejects.toThrow(BadRequestException);
      await expect(service.crearServicio(dto)).rejects.toThrow('Uno o más barberos seleccionados no existen o no se encuentran en estado ACTIVO');
    });

    it('Debe lanzar ConflictException al intentar crear un servicio con un nombre que ya existe', async () => {
      const dto = {
        nombre: 'Corte Clásico',
        precio: 20000,
        duracionMinutos: 30,
        barberoIds: [1],
      };

      repository.obtenerServicioPorNombre.mockResolvedValue({ id: 10, nombre: 'Corte Clásico' } as any);

      await expect(service.crearServicio(dto)).rejects.toThrow(ConflictException);
      await expect(service.crearServicio(dto)).rejects.toThrow('Ya existe un servicio con este nombre');
    });

    it('Debe crear el servicio exitosamente si todo está correcto', async () => {
      const dto = {
        nombre: 'Corte Nuevo',
        precio: 25000,
        duracionMinutos: 40,
        barberoIds: [1, 2],
      };

      repository.obtenerServicioPorNombre.mockResolvedValue(null);
      // Ambos barberos existen y están activos
      repository.obtenerBarberosActivosPorIds.mockResolvedValue([{ id: 1 }, { id: 2 }] as any);
      repository.crearServicio.mockResolvedValue({ id: 99, ...dto } as any);

      const resultado = await service.crearServicio(dto);

      expect(resultado.id).toBe(99);
      expect(repository.crearServicio).toHaveBeenCalledWith(expect.objectContaining({
        nombre: 'Corte Nuevo',
        precio: 25000,
      }));
    });
  });

  describe('actualizarServicio', () => {
    it('Debe actualizar el servicio y sus barberos exitosamente', async () => {
      const dto = { nombre: 'Corte Editado', barberoIds: [3] };
      repository.obtenerServicioPorId = jest.fn().mockResolvedValue({ id: 99, nombre: 'Antiguo' } as any);
      repository.obtenerServicioPorNombre.mockResolvedValue(null);
      repository.obtenerBarberosActivosPorIds.mockResolvedValue([{ id: 3 }] as any);
      repository.actualizarServicio = jest.fn().mockResolvedValue({ id: 99, ...dto } as any);

      const resultado = await service.actualizarServicio(99, dto);

      expect(resultado.id).toBe(99);
      expect(repository.actualizarServicio).toHaveBeenCalledWith(99, expect.objectContaining({ nombre: 'Corte Editado', barberoIds: [3] }));
    });
  });
});

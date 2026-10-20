import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'node:fs';
import { ServiciosService } from './servicios.service';
import { ServiciosRepository } from '../repository/servicios.repository';
import { FiltroServiciosDto } from '../dto/dto-peticion/filtro-servicios.dto';

jest.mock('node:fs');

describe('ServiciosService', () => {
  let service: ServiciosService;
  let repository: jest.Mocked<ServiciosRepository>;

  beforeEach(async () => {
    const mockRepository = {
      obtenerBarberosActivosPorIds: jest.fn(),
      obtenerBarberoActivoEnNegocio: jest.fn(),
      obtenerServicioPorNombre: jest.fn(),
      obtenerServicioPorId: jest.fn(),
      obtenerServicioActivoPorId: jest.fn(),
      crearServicio: jest.fn(),
      actualizarServicio: jest.fn(),
      cambiarEstado: jest.fn(),
      listarServiciosCatalogo: jest.fn(),
      listarServiciosGestion: jest.fn(),
      listarServiciosPorBarbero: jest.fn(),
      listarBarberosActivosPorServicio: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiciosService,
        { provide: ServiciosRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get<ServiciosService>(ServiciosService);
    repository = module.get(ServiciosRepository);
    jest.clearAllMocks();
  });

  describe('crearServicio', () => {
    it('Debe lanzar BadRequestException si uno o más barberos no existen o están inactivos', async () => {
      const dto = {
        nombre: 'Corte Premium',
        precio: 30000,
        duracionMinutos: 45,
        barberoIds: [1, 2],
      };

      repository.obtenerServicioPorNombre.mockResolvedValue(null);
      repository.obtenerBarberosActivosPorIds.mockResolvedValue([
        { id: 1 },
      ]);

      await expect(service.crearServicio(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Debe lanzar ConflictException al intentar crear un servicio con un nombre que ya existe', async () => {
      const dto = {
        nombre: 'Corte Clásico',
        precio: 20000,
        duracionMinutos: 30,
        barberoIds: [1],
      };

      repository.obtenerServicioPorNombre.mockResolvedValue({
        id: 10,
        nombre: 'Corte Clásico',
      } as any);

      await expect(service.crearServicio(dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('Debe crear el servicio exitosamente si todo está correcto', async () => {
      const dto = {
        nombre: 'Corte Nuevo',
        precio: 25000,
        duracionMinutos: 40,
        barberoIds: [1, 2],
      };

      repository.obtenerServicioPorNombre.mockResolvedValue(null);
      repository.obtenerBarberosActivosPorIds.mockResolvedValue([
        { id: 1 },
        { id: 2 },
      ]);
      repository.crearServicio.mockResolvedValue({ id: 99, ...dto } as any);

      const resultado = await service.crearServicio(dto);

      expect(resultado.id).toBe(99);
      expect(repository.crearServicio).toHaveBeenCalledWith(
        expect.objectContaining({
          nombre: 'Corte Nuevo',
          precio: 25000,
        }),
      );
    });

    it('debe omitir la validación de barberos cuando no se envían barberoIds', async () => {
      const dto = {
        nombre: 'Corte Simple',
        precio: 10000,
        duracionMinutos: 20,
      };

      repository.obtenerServicioPorNombre.mockResolvedValue(null);
      repository.crearServicio.mockResolvedValue({ id: 5, ...dto } as any);

      const resultado = await service.crearServicio(dto);

      expect(resultado.id).toBe(5);
      expect(repository.obtenerBarberosActivosPorIds).not.toHaveBeenCalled();
    });
  });

  describe('obtenerServicioPorId', () => {
    it('debe lanzar NotFoundException si el servicio no existe', async () => {
      repository.obtenerServicioPorId.mockResolvedValue(null);

      await expect(service.obtenerServicioPorId(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('debe retornar el servicio mapeado si existe', async () => {
      repository.obtenerServicioPorId.mockResolvedValue({
        id: 1,
        nombre: 'Barba',
        precio: 15000,
        duracionMinutos: 20,
        barberos: [],
      } as any);

      const resultado = await service.obtenerServicioPorId(1);
      expect(resultado.id).toBe(1);
      expect(resultado.nombre).toBe('Barba');
    });
  });

  describe('obtenerServiciosPorBarbero', () => {
    it('debe listar servicios activos de un barbero', async () => {
      repository.obtenerBarberoActivoEnNegocio.mockResolvedValue({
        id: 5,
      });
      repository.listarServiciosPorBarbero.mockResolvedValue([
        {
          id: 1,
          nombre: 'Corte',
          precio: 20000,
          duracionMinutos: 30,
          barberos: [],
        },
      ] as any);

      const res = await service.obtenerServiciosPorBarbero(5);
      expect(res).toHaveLength(1);
      expect(repository.obtenerBarberoActivoEnNegocio).toHaveBeenCalledWith(5);
      expect(repository.listarServiciosPorBarbero).toHaveBeenCalledWith(5);
    });

    it('debe responder 404 si el barbero no pertenece a la barbería', async () => {
      repository.obtenerBarberoActivoEnNegocio.mockResolvedValue(null);

      await expect(service.obtenerServiciosPorBarbero(99)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.listarServiciosPorBarbero).not.toHaveBeenCalled();
    });
  });

  describe('obtenerBarberosPorServicio (HE-04-HU-02)', () => {
    it('debe lanzar NotFoundException si el servicio no existe o está inactivo', async () => {
      repository.obtenerServicioActivoPorId.mockResolvedValue(null);

      await expect(service.obtenerBarberosPorServicio(999)).rejects.toThrow(
        NotFoundException,
      );
      expect(
        repository.listarBarberosActivosPorServicio,
      ).not.toHaveBeenCalled();
    });

    it('debe devolver lista vacía cuando el servicio existe pero ningún barbero lo presta', async () => {
      repository.obtenerServicioActivoPorId.mockResolvedValue({ id: 1 } as any);
      repository.listarBarberosActivosPorServicio.mockResolvedValue([]);

      const res = await service.obtenerBarberosPorServicio(1);

      expect(res).toEqual([]);
      expect(repository.listarBarberosActivosPorServicio).toHaveBeenCalledWith(
        1,
      );
    });

    it('debe mapear los barberos con el Barbero.id (no el Usuario.id) y ordenarlos por nombre', async () => {
      repository.obtenerServicioActivoPorId.mockResolvedValue({ id: 1 } as any);
      repository.listarBarberosActivosPorServicio.mockResolvedValue([
        {
          id: 30,
          fotoUrl: null,
          usuario: { id: 300, nombre: 'Zoe', apellido: 'Díaz' },
        },
        {
          id: 10,
          fotoUrl: '/uploads/barberos/ana.jpg',
          usuario: { id: 100, nombre: 'Ana', apellido: 'Ruiz' },
        },
      ]);

      const res = await service.obtenerBarberosPorServicio(1);

      expect(res).toEqual([
        {
          id: 10,
          nombre: 'Ana',
          apellido: 'Ruiz',
          fotoUrl: '/uploads/barberos/ana.jpg',
        },
        { id: 30, nombre: 'Zoe', apellido: 'Díaz', fotoUrl: null },
      ]);
      // El id expuesto es Barbero.id, no Usuario.id (100/300).
      expect(res.map((b) => b.id)).toEqual([10, 30]);
    });
  });

  describe('actualizarServicio', () => {
    it('Debe rechazar actualización si el nuevo nombre ya pertenece a otro servicio', async () => {
      repository.obtenerServicioPorId.mockResolvedValue({
        id: 1,
        nombre: 'Corte A',
      } as any);
      repository.obtenerServicioPorNombre.mockResolvedValue({
        id: 2,
        nombre: 'Corte B',
      } as any);

      await expect(
        service.actualizarServicio(1, { nombre: 'Corte B' }),
      ).rejects.toThrow(ConflictException);
    });

    it('Debe actualizar el servicio y sus barberos exitosamente', async () => {
      const dto = { nombre: 'Corte Editado', barberoIds: [3] };
      repository.obtenerServicioPorId.mockResolvedValue({
        id: 99,
        nombre: 'Antiguo',
      } as any);
      repository.obtenerServicioPorNombre.mockResolvedValue(null);
      repository.obtenerBarberosActivosPorIds.mockResolvedValue([
        { id: 3 },
      ]);
      repository.actualizarServicio.mockResolvedValue({
        id: 99,
        ...dto,
      } as any);

      const resultado = await service.actualizarServicio(99, dto);

      expect(resultado.id).toBe(99);
      expect(repository.actualizarServicio).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ nombre: 'Corte Editado', barberoIds: [3] }),
      );
    });
  });

  describe('cambiarEstadoServicio', () => {
    it('debe cambiar el estado del servicio exitosamente', async () => {
      repository.obtenerServicioPorId.mockResolvedValue({
        id: 1,
        nombre: 'Corte',
      } as any);
      repository.cambiarEstado.mockResolvedValue({
        id: 1,
        estado: 'INACTIVO',
      } as any);

      const res = await service.cambiarEstadoServicio(1, {
        estado: 'INACTIVO',
      });
      expect(res.estado).toBe('INACTIVO');
      expect(repository.cambiarEstado).toHaveBeenCalledWith(1, 'INACTIVO');
    });
  });

  describe('subirFotoServicio y eliminarFotoServicio', () => {
    it('debe subir foto nueva eliminando la anterior si existía en disco', async () => {
      repository.obtenerServicioPorId.mockResolvedValue({
        id: 1,
        fotoUrl: '/uploads/servicios/foto-vieja.jpg',
      } as any);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      repository.actualizarServicio.mockResolvedValue({
        id: 1,
        fotoUrl: '/uploads/servicios/nueva.jpg',
      } as any);

      const res = await service.subirFotoServicio(1, {
        filename: 'nueva.jpg',
      } as any);

      expect(res.fotoUrl).toBe('/uploads/servicios/nueva.jpg');
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('debe eliminar la foto existente física y en base de datos', async () => {
      repository.obtenerServicioPorId.mockResolvedValue({
        id: 1,
        fotoUrl: '/uploads/servicios/foto.jpg',
      } as any);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);

      const res = await service.eliminarFotoServicio(1);

      expect(res.fotoUrl).toBeNull();
      expect(repository.actualizarServicio).toHaveBeenCalledWith(1, {
        fotoUrl: null,
      });
    });

    it('debe continuar y registrar un warning si falla el borrado de la foto anterior al subir', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      repository.obtenerServicioPorId.mockResolvedValue({
        id: 1,
        fotoUrl: '/uploads/servicios/foto-vieja.jpg',
      } as any);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {
        throw new Error('permiso denegado');
      });
      repository.actualizarServicio.mockResolvedValue({
        id: 1,
        fotoUrl: '/uploads/servicios/nueva.jpg',
      } as any);

      const res = await service.subirFotoServicio(1, {
        filename: 'nueva.jpg',
      } as any);

      expect(res.fotoUrl).toBe('/uploads/servicios/nueva.jpg');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('debe continuar y registrar un warning si falla el borrado físico al eliminar la foto', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      repository.obtenerServicioPorId.mockResolvedValue({
        id: 1,
        fotoUrl: '/uploads/servicios/foto.jpg',
      } as any);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {
        throw new Error('permiso denegado');
      });

      const res = await service.eliminarFotoServicio(1);

      expect(res.fotoUrl).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('obtenerServiciosCatalogo y obtenerServiciosGestion', () => {
    it('Debe consultar servicios del catálogo con filtro de búsqueda', async () => {
      const mockServiciosPrisma = [
        {
          id: 1,
          nombre: 'Corte De Barba',
          precio: 15000,
          duracionMinutos: 20,
          fotoUrl: null,
          barberos: [
            {
              barbero: {
                id: 5,
                telefono: '300111',
                fotoUrl: null,
                usuario: { id: 50, nombre: 'Pedro', apellido: 'Lopez' },
              },
            },
          ],
        },
      ];
      repository.listarServiciosCatalogo.mockResolvedValue(
        mockServiciosPrisma as any,
      );

      const filtro: FiltroServiciosDto = { nombre: 'Barba' };
      const resultado = await service.obtenerServiciosCatalogo(filtro);

      expect(repository.listarServiciosCatalogo).toHaveBeenCalledWith(filtro);
      expect(resultado).toHaveLength(1);
      expect(resultado[0].nombre).toBe('Corte De Barba');
      expect(resultado[0].barberos).toHaveLength(1);
      // El id publicado es el del perfil de barbero (Barbero.id = 5), NO el
      // del usuario (Usuario.id = 50): es la clave que consumen la
      // disponibilidad y la reserva.
      expect(resultado[0].barberos[0].id).toBe(5);
    });

    it('Debe consultar servicios para gestión interna con filtro de búsqueda y estado', async () => {
      const mockServiciosPrisma = [
        {
          id: 2,
          nombre: 'Tinte de Cabello',
          precio: 50000,
          duracionMinutos: 60,
          estado: 'ACTIVO',
          fotoUrl: null,
          barberos: [],
        },
      ];
      repository.listarServiciosGestion.mockResolvedValue(
        mockServiciosPrisma as any,
      );

      const filtro: FiltroServiciosDto = {
        nombre: 'Tinte',
        estado: 'ACTIVO',
      };
      const resultado = await service.obtenerServiciosGestion(filtro);

      expect(repository.listarServiciosGestion).toHaveBeenCalledWith(filtro);
      expect(resultado).toHaveLength(1);
      expect(resultado[0].nombre).toBe('Tinte de Cabello');
      expect(resultado[0].estado).toBe('ACTIVO');
    });
  });
});

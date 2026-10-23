import { Test, TestingModule } from '@nestjs/testing';
import { ServiciosRepository } from './servicios.repository';
import { PrismaService } from '../../../prisma/prisma.service';

// Mock the generated Prisma enums so they resolve correctly in Jest
jest.mock('../../../../generated/prisma/enums', () => ({
  EstadoServicio: { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' },
  EstadoUsuario: { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' },
}));

const EstadoServicio = { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' } as const;
const EstadoUsuario = { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' } as const;

const mockPrisma = {
  barbero: { findMany: jest.fn() },
  barberoServicio: { findUnique: jest.fn(), findMany: jest.fn() },
  servicio: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

describe('ServiciosRepository', () => {
  let repository: ServiciosRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiciosRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    repository = module.get<ServiciosRepository>(ServiciosRepository);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('obtenerBarberosActivosPorIds', () => {
    it('should return active barberos by ids', async () => {
      mockPrisma.barbero.findMany.mockResolvedValue([{ usuarioId: 1 }]);
      const result = await repository.obtenerBarberosActivosPorIds([1]);
      expect(mockPrisma.barbero.findMany).toHaveBeenCalled();
      expect(result).toEqual([{ usuarioId: 1 }]);
    });
  });

  describe('obtenerServicioPorNombre', () => {
    it('should return a service by name', async () => {
      mockPrisma.servicio.findUnique.mockResolvedValue({
        id: 1,
        nombre: 'Corte',
      });
      const result = await repository.obtenerServicioPorNombre('Corte');
      expect(mockPrisma.servicio.findUnique).toHaveBeenCalledWith({
        where: { nombre: 'Corte' },
      });
      expect(result).toEqual({ id: 1, nombre: 'Corte' });
    });
  });

  describe('obtenerServicioPorId', () => {
    it('should return a service by id with barberos', async () => {
      mockPrisma.servicio.findUnique.mockResolvedValue({ id: 1 });
      const result = await repository.obtenerServicioPorId(1);
      expect(mockPrisma.servicio.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('obtenerServicioActivoPorId', () => {
    it('should return an ACTIVO service by id', async () => {
      mockPrisma.servicio.findFirst.mockResolvedValue({ id: 1 });
      const result = await repository.obtenerServicioActivoPorId(1);
      expect(mockPrisma.servicio.findFirst).toHaveBeenCalledWith({
        where: { id: 1, estado: EstadoServicio.ACTIVO },
      });
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('existeAsignacionBarbero', () => {
    it('should return true when the assignment exists', async () => {
      mockPrisma.barberoServicio.findUnique.mockResolvedValue({ barberoId: 3 });
      const result = await repository.existeAsignacionBarbero(3, 2);
      expect(mockPrisma.barberoServicio.findUnique).toHaveBeenCalledWith({
        where: { barberoId_servicioId: { barberoId: 3, servicioId: 2 } },
        select: { barberoId: true },
      });
      expect(result).toBe(true);
    });

    it('should return false when the assignment does not exist', async () => {
      mockPrisma.barberoServicio.findUnique.mockResolvedValue(null);
      const result = await repository.existeAsignacionBarbero(3, 2);
      expect(result).toBe(false);
    });
  });

  describe('listarServiciosCatalogo', () => {
    it('should return active services without filter', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([{ id: 1 }]);
      const result = await repository.listarServiciosCatalogo();
      expect(mockPrisma.servicio.findMany).toHaveBeenCalledWith({
        where: {
          estado: EstadoServicio.ACTIVO,
          barberos: {
            some: {
              barbero: {
                estado: EstadoUsuario.ACTIVO,
                usuario: {
                  estado: EstadoUsuario.ACTIVO,
                },
                weeklySlots: {
                  some: {
                    active: true,
                  },
                },
              },
            },
          },
        },
        include: expect.any(Object),
        orderBy: { nombre: 'asc' },
      });
      expect(result).toEqual([{ id: 1 }]);
    });

    it('should apply nombre filter to catalogo', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([]);
      await repository.listarServiciosCatalogo({ nombre: 'Corte' });
      expect(mockPrisma.servicio.findMany).toHaveBeenCalledWith({
        where: {
          estado: EstadoServicio.ACTIVO,
          barberos: {
            some: {
              barbero: {
                estado: EstadoUsuario.ACTIVO,
                usuario: {
                  estado: EstadoUsuario.ACTIVO,
                },
                weeklySlots: {
                  some: {
                    active: true,
                  },
                },
              },
            },
          },
          OR: [
            { nombre: { contains: 'Corte' } },
            { descripcion: { contains: 'Corte' } },
          ],
        },
        include: expect.any(Object),
        orderBy: { nombre: 'asc' },
      });
    });
  });

  describe('listarServiciosGestion', () => {
    it('should return all services without filter', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([{ id: 1 }]);
      const result = await repository.listarServiciosGestion();
      expect(mockPrisma.servicio.findMany).toHaveBeenCalledWith({
        where: {},
        include: expect.any(Object),
        orderBy: { id: 'desc' },
      });
      expect(result).toEqual([{ id: 1 }]);
    });

    it('should filter by estado', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([]);
      await repository.listarServiciosGestion({
        estado: EstadoServicio.ACTIVO,
      });
      expect(mockPrisma.servicio.findMany).toHaveBeenCalledWith({
        where: { estado: EstadoServicio.ACTIVO },
        include: expect.any(Object),
        orderBy: { id: 'desc' },
      });
    });

    it('should filter by nombre', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([]);
      await repository.listarServiciosGestion({ nombre: 'Corte' });
      expect(mockPrisma.servicio.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { nombre: { contains: 'Corte' } },
            { descripcion: { contains: 'Corte' } },
          ],
        },
        include: expect.any(Object),
        orderBy: { id: 'desc' },
      });
    });
  });

  describe('listarServiciosPorBarbero', () => {
    it('should return active services for a barbero', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([{ id: 1 }]);
      const result = await repository.listarServiciosPorBarbero(5);
      expect(mockPrisma.servicio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            estado: EstadoServicio.ACTIVO,
            barberos: {
              some: {
                OR: [{ barberoId: 5 }, { barbero: { usuarioId: 5 } }],
              },
            },
          }),
        }),
      );
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('listarBarberosActivosPorServicio (HE-04-HU-02)', () => {
    it('should return barberos with Barbero.id and map to flat barbero objects', async () => {
      mockPrisma.barberoServicio.findMany.mockResolvedValue([
        {
          barbero: {
            id: 10,
            fotoUrl: '/uploads/barberos/ana.jpg',
            usuario: { id: 100, nombre: 'Ana', apellido: 'Ruiz' },
          },
        },
        {
          barbero: {
            id: 30,
            fotoUrl: null,
            usuario: { id: 300, nombre: 'Zoe', apellido: 'Díaz' },
          },
        },
      ]);

      const result = await repository.listarBarberosActivosPorServicio(2);

      expect(mockPrisma.barberoServicio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            servicioId: 2,
            barbero: {
              estado: 'ACTIVO',
              usuario: { estado: 'ACTIVO' },
              weeklySlots: {
                some: {
                  active: true,
                },
              },
            },
          }),
          select: expect.any(Object),
          orderBy: { barberoId: 'asc' },
        }),
      );
      expect(result).toEqual([
        {
          id: 10,
          fotoUrl: '/uploads/barberos/ana.jpg',
          usuario: { id: 100, nombre: 'Ana', apellido: 'Ruiz' },
        },
        {
          id: 30,
          fotoUrl: null,
          usuario: { id: 300, nombre: 'Zoe', apellido: 'Díaz' },
        },
      ]);
    });

    it('should return empty array when no active barberos for the service', async () => {
      mockPrisma.barberoServicio.findMany.mockResolvedValue([]);

      const result = await repository.listarBarberosActivosPorServicio(2);

      expect(result).toEqual([]);
    });
  });

  describe('crearServicio', () => {
    it('should create a service without barberos', async () => {
      mockPrisma.servicio.create.mockResolvedValue({ id: 1, nombre: 'Corte' });
      const result = await repository.crearServicio({
        nombre: 'Corte',
        precio: 20000,
        duracionMinutos: 30,
      });
      expect(mockPrisma.servicio.create).toHaveBeenCalled();
      expect(result).toEqual({ id: 1, nombre: 'Corte' });
    });

    it('should create a service with barberos', async () => {
      mockPrisma.servicio.create.mockResolvedValue({ id: 1 });
      await repository.crearServicio({
        nombre: 'Corte',
        precio: 20000,
        duracionMinutos: 30,
        barberoIds: [1, 2],
      });
      const call = mockPrisma.servicio.create.mock.calls[0][0];
      expect(call.data.barberos).toBeDefined();
      expect(call.data.barberos.create).toHaveLength(2);
    });
  });

  describe('actualizarServicio', () => {
    it('should update a service without touching barberos', async () => {
      mockPrisma.servicio.update.mockResolvedValue({
        id: 1,
        nombre: 'Corte Actualizado',
      });
      const result = await repository.actualizarServicio(1, {
        nombre: 'Corte Actualizado',
      });
      expect(mockPrisma.servicio.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
      expect(result).toEqual({ id: 1, nombre: 'Corte Actualizado' });
    });

    it('should sync barberos when barberoIds is provided', async () => {
      mockPrisma.servicio.update.mockResolvedValue({ id: 1 });
      await repository.actualizarServicio(1, { barberoIds: [3] });
      const call = mockPrisma.servicio.update.mock.calls[0][0];
      expect(call.data.barberos.deleteMany).toEqual({});
      expect(call.data.barberos.create).toHaveLength(1);
    });
  });

  describe('cambiarEstado', () => {
    it('should change service status', async () => {
      mockPrisma.servicio.update.mockResolvedValue({
        id: 1,
        estado: EstadoServicio.INACTIVO,
      });
      const result = await repository.cambiarEstado(1, EstadoServicio.INACTIVO);
      expect(mockPrisma.servicio.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { estado: EstadoServicio.INACTIVO },
        }),
      );
      expect(result.estado).toBe(EstadoServicio.INACTIVO);
    });
  });
});

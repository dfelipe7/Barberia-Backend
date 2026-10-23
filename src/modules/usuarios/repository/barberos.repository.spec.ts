import { Test, TestingModule } from '@nestjs/testing';
import { BarberosRepository } from './barberos.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { EstadoUsuario } from '../../../../generated/prisma/enums';

const mockPrismaService = {
  barbero: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('BarberosRepository', () => {
  let repository: BarberosRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarberosRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<BarberosRepository>(BarberosRepository);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('crearBarberoNuevo', () => {
    it('should create a new barbero', async () => {
      const data = { usuarioId: 1, telefono: '123', porcentajeComision: 50 };
      mockPrismaService.barbero.create.mockResolvedValue({ ...data });

      const result = await repository.crearBarberoNuevo(data);

      expect(prisma.barbero.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(data);
    });
  });

  describe('crearPerfilBarbero', () => {
    it('should call crearBarberoNuevo', async () => {
      const data = { usuarioId: 1, telefono: '123', porcentajeComision: 50 };
      jest
        .spyOn(repository, 'crearBarberoNuevo')
        .mockResolvedValue({ ...data } as any);

      const result = await repository.crearPerfilBarbero(data);

      expect(repository.crearBarberoNuevo).toHaveBeenCalledWith(data);
      expect(result).toEqual(data);
    });
  });

  describe('actualizarComision', () => {
    it('should update comision', async () => {
      mockPrismaService.barbero.update.mockResolvedValue({
        usuarioId: 1,
        porcentajeComision: 60,
      });

      const result = await repository.actualizarComision(1, 60);

      expect(prisma.barbero.update).toHaveBeenCalledWith({
        where: { usuarioId: 1 },
        data: { porcentajeComision: 60 },
      });
      expect(result.porcentajeComision).toBe(60);
    });
  });

  describe('actualizarPerfilBarbero', () => {
    it('should update barbero profile', async () => {
      const data = { telefono: '456' };
      mockPrismaService.barbero.update.mockResolvedValue({
        usuarioId: 1,
        ...data,
      });

      const result = await repository.actualizarPerfilBarbero(1, data);

      expect(prisma.barbero.update).toHaveBeenCalledWith({
        where: { usuarioId: 1 },
        data,
      });
      expect(result).toEqual({ usuarioId: 1, telefono: '456' });
    });
  });

  describe('obtenerBarberoPorUsuarioId', () => {
    it('should return barbero by id', async () => {
      mockPrismaService.barbero.findUnique.mockResolvedValue({ usuarioId: 1 });

      const result = await repository.obtenerBarberoPorUsuarioId(1);

      expect(prisma.barbero.findUnique).toHaveBeenCalledWith({
        where: { usuarioId: 1 },
      });
      expect(result).toEqual({ usuarioId: 1 });
    });
  });

  describe('obtenerBarberoActivoPorId', () => {
    it('should query only when barbero and usuario are ACTIVO', async () => {
      mockPrismaService.barbero.findFirst.mockResolvedValue({ id: 7 });

      const result = await repository.obtenerBarberoActivoPorId(7);

      expect(prisma.barbero.findFirst).toHaveBeenCalledWith({
        where: {
          id: 7,
          estado: EstadoUsuario.ACTIVO,
          usuario: { estado: EstadoUsuario.ACTIVO },
        },
      });
      expect(result).toEqual({ id: 7 });
    });
  });

  describe('obtenerBarberosCatalogo', () => {
    it('should return barberos with ACTIVO status', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);

      const result = await repository.obtenerBarberosCatalogo();

      expect(prisma.barbero.findMany).toHaveBeenCalledWith({
        where: {
          estado: EstadoUsuario.ACTIVO,
          usuario: { estado: EstadoUsuario.ACTIVO },
          weeklySlots: {
            some: {
              active: true,
            },
          },
        },
        include: expect.any(Object),
      });
      expect(result).toEqual([{ id: 1 }]);
    });

    it('should filter by nombre', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);

      await repository.obtenerBarberosCatalogo({ nombre: 'Juan' });

      expect(prisma.barbero.findMany).toHaveBeenCalledWith({
        where: {
          estado: EstadoUsuario.ACTIVO,
          usuario: {
            estado: EstadoUsuario.ACTIVO,
            OR: [
              { nombre: { contains: 'Juan' } },
              { apellido: { contains: 'Juan' } },
            ],
          },
          weeklySlots: {
            some: {
              active: true,
            },
          },
        },
        include: expect.any(Object),
      });
    });
  });

  describe('obtenerBarberosGestion', () => {
    it('should return all barberos without filters', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);
      await repository.obtenerBarberosGestion();
      expect(prisma.barbero.findMany).toHaveBeenCalledWith({
        where: {},
        include: expect.any(Object),
      });
    });

    it('should filter by ACTIVO status', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);
      await repository.obtenerBarberosGestion({ estado: EstadoUsuario.ACTIVO });
      expect(prisma.barbero.findMany).toHaveBeenCalledWith({
        where: {
          estado: EstadoUsuario.ACTIVO,
          usuario: { estado: EstadoUsuario.ACTIVO },
        },
        include: expect.any(Object),
      });
    });

    it('should filter by INACTIVO status', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);
      await repository.obtenerBarberosGestion({
        estado: EstadoUsuario.INACTIVO,
      });
      expect(prisma.barbero.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { estado: EstadoUsuario.INACTIVO },
            { usuario: { estado: EstadoUsuario.INACTIVO } },
          ],
        },
        include: expect.any(Object),
      });
    });

    it('should filter by nombre', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);
      await repository.obtenerBarberosGestion({ nombre: 'Juan' });
      expect(prisma.barbero.findMany).toHaveBeenCalledWith({
        where: {
          usuario: {
            OR: [
              { nombre: { contains: 'Juan' } },
              { apellido: { contains: 'Juan' } },
              { email: { contains: 'Juan' } },
            ],
          },
        },
        include: expect.any(Object),
      });
    });
  });

  describe('actualizarEstadoBarbero', () => {
    it('should update status', async () => {
      mockPrismaService.barbero.update.mockResolvedValue({
        usuarioId: 1,
        estado: EstadoUsuario.ACTIVO,
      });
      const result = await repository.actualizarEstadoBarbero(
        1,
        EstadoUsuario.ACTIVO,
      );
      expect(prisma.barbero.update).toHaveBeenCalledWith({
        where: { usuarioId: 1 },
        data: { estado: EstadoUsuario.ACTIVO },
      });
      expect(result.estado).toBe(EstadoUsuario.ACTIVO);
    });
  });

  describe('obtenerBarberoPorId', () => {
    it('debe consultar el barbero por id incluyendo su usuario', async () => {
      const mockBarbero = { id: 5, usuario: { id: 10, nombre: 'Carlos' } };
      mockPrismaService.barbero.findUnique.mockResolvedValue(mockBarbero);

      const result = await repository.obtenerBarberoPorId(5);

      expect(prisma.barbero.findUnique).toHaveBeenCalledWith({
        where: { id: 5 },
        include: { usuario: true },
      });
      expect(result).toBe(mockBarbero);
    });

    it('debe retornar null si no existe el barbero', async () => {
      mockPrismaService.barbero.findUnique.mockResolvedValue(null);

      const result = await repository.obtenerBarberoPorId(999);

      expect(result).toBeNull();
    });
  });
});

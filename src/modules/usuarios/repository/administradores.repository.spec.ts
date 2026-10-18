import { Test, TestingModule } from '@nestjs/testing';
import { AdministradoresRepository } from './administradores.repository';
import { PrismaService } from '../../../prisma/prisma.service';

const mockPrismaService = {
  administrador: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
};

describe('AdministradoresRepository', () => {
  let repository: AdministradoresRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdministradoresRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<AdministradoresRepository>(
      AdministradoresRepository,
    );
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('crearAdministrador', () => {
    it('should create an administrator', async () => {
      const data = { usuarioId: 1 };
      mockPrismaService.administrador.create.mockResolvedValue({
        usuarioId: 1,
        estado: 'ACTIVO',
      });

      const result = await repository.crearAdministrador(data);

      expect(prisma.administrador.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual({ usuarioId: 1, estado: 'ACTIVO' });
    });
  });

  describe('obtenerAdministradores', () => {
    it('should return a list of administrators without filters', async () => {
      mockPrismaService.administrador.findMany.mockResolvedValue([
        { usuarioId: 1 },
      ]);
      const result = await repository.obtenerAdministradores();

      expect(prisma.administrador.findMany).toHaveBeenCalled();
      expect(result).toEqual([{ usuarioId: 1 }]);
    });

    it('should return a list of active administrators with ACTIVO filter', async () => {
      mockPrismaService.administrador.findMany.mockResolvedValue([
        { usuarioId: 1 },
      ]);
      await repository.obtenerAdministradores({ estado: 'ACTIVO' });

      expect(prisma.administrador.findMany).toHaveBeenCalledWith({
        where: {
          usuario: {
            rol: { not: 'SUPERADMIN' },
            estado: 'ACTIVO',
          },
          estado: 'ACTIVO',
        },
        include: expect.any(Object),
      });
    });

    it('should return a list of administrators with INACTIVO filter', async () => {
      mockPrismaService.administrador.findMany.mockResolvedValue([
        { usuarioId: 1 },
      ]);
      await repository.obtenerAdministradores({ estado: 'INACTIVO' });

      expect(prisma.administrador.findMany).toHaveBeenCalledWith({
        where: {
          usuario: {
            rol: { not: 'SUPERADMIN' },
          },
          OR: [{ estado: 'INACTIVO' }, { usuario: { estado: 'INACTIVO' } }],
        },
        include: expect.any(Object),
      });
    });

    it('should return a list of administrators filtered by nombre', async () => {
      mockPrismaService.administrador.findMany.mockResolvedValue([
        { usuarioId: 1 },
      ]);
      await repository.obtenerAdministradores({ nombre: 'Juan' });

      expect(prisma.administrador.findMany).toHaveBeenCalledWith({
        where: {
          usuario: {
            rol: { not: 'SUPERADMIN' },
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

  describe('actualizarEstadoAdministrador', () => {
    it('should update administrator state', async () => {
      mockPrismaService.administrador.update.mockResolvedValue({
        usuarioId: 1,
        estado: 'INACTIVO',
      });

      const result = await repository.actualizarEstadoAdministrador(
        1,
        'INACTIVO',
      );

      expect(prisma.administrador.update).toHaveBeenCalledWith({
        where: { usuarioId: 1 },
        data: { estado: 'INACTIVO' },
      });
      expect(result).toEqual({ usuarioId: 1, estado: 'INACTIVO' });
    });
  });

  describe('obtenerAdministradorPorUsuarioId', () => {
    it('should return an administrator by user ID', async () => {
      mockPrismaService.administrador.findUnique.mockResolvedValue({
        usuarioId: 1,
      });

      const result = await repository.obtenerAdministradorPorUsuarioId(1);

      expect(prisma.administrador.findUnique).toHaveBeenCalledWith({
        where: { usuarioId: 1 },
      });
      expect(result).toEqual({ usuarioId: 1 });
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { RedesSocialesRepository } from './redes-sociales.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { TipoRedSocial } from '../../../../generated/prisma/enums';

describe('RedesSocialesRepository', () => {
  let repository: RedesSocialesRepository;
  let prisma: jest.Mocked<PrismaService>;

  const mockRed = {
    id: 1,
    negocioId: 1,
    tipo: TipoRedSocial.INSTAGRAM,
    nombre: 'Instagram',
    url: 'https://instagram.com/kyrios',
    orden: 1,
    activo: true,
  };

  beforeEach(async () => {
    const mockPrisma = {
      redSocialNegocio: {
        findMany: jest.fn().mockResolvedValue([mockRed]),
        findUnique: jest.fn().mockResolvedValue(mockRed),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue(mockRed),
        update: jest.fn().mockResolvedValue(mockRed),
        delete: jest.fn().mockResolvedValue(mockRed),
      },
    };

    const mockAislamiento = {
      filtroLectura: jest.fn().mockImplementation((w) => w),
      filtroEscritura: jest.fn().mockImplementation((w) => w),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedesSocialesRepository,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NegocioAislamientoService, useValue: mockAislamiento },
      ],
    }).compile();

    repository = module.get<RedesSocialesRepository>(RedesSocialesRepository);
    prisma = module.get(PrismaService);
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  describe('listarPorNegocio', () => {
    it('lista solo activas por defecto', async () => {
      const res = await repository.listarPorNegocio(1);
      expect(prisma.redSocialNegocio.findMany).toHaveBeenCalledWith({
        where: { negocioId: 1, activo: true },
        orderBy: [{ orden: 'asc' }, { id: 'asc' }],
        select: expect.any(Object),
      });
      expect(res).toEqual([mockRed]);
    });

    it('incluye inactivas cuando el flag es true', async () => {
      await repository.listarPorNegocio(1, true);
      expect(prisma.redSocialNegocio.findMany).toHaveBeenCalledWith({
        where: { negocioId: 1 },
        orderBy: [{ orden: 'asc' }, { id: 'asc' }],
        select: expect.any(Object),
      });
    });
  });

  describe('reemplazar', () => {
    it('desactiva no presentes y hace upsert de las nuevas', async () => {
      const nuevas = [
        {
          tipo: TipoRedSocial.INSTAGRAM,
          nombre: 'Instagram',
          url: 'https://instagram.com/kyrios',
          orden: 0,
        },
      ];

      const res = await repository.reemplazar(1, nuevas);
      expect(prisma.redSocialNegocio.updateMany).toHaveBeenCalled();
      expect(prisma.redSocialNegocio.upsert).toHaveBeenCalledTimes(1);
      expect(res).toEqual([mockRed]);
    });

    it('maneja reemplazo con array vacio', async () => {
      await repository.reemplazar(1, []);
      expect(prisma.redSocialNegocio.updateMany).toHaveBeenCalledWith({
        where: { negocioId: 1, NOT: undefined },
        data: { activo: false },
      });
    });
  });

  describe('obtenerPorId', () => {
    it('devuelve la red si existe', async () => {
      const res = await repository.obtenerPorId(1, 10);
      expect(prisma.redSocialNegocio.findUnique).toHaveBeenCalledWith({
        where: { negocioId_id: { negocioId: 1, id: 10 } },
        select: expect.any(Object),
      });
      expect(res).toEqual(mockRed);
    });

    it('devuelve null si no existe', async () => {
      (prisma.redSocialNegocio.findUnique as jest.Mock).mockResolvedValue(null);
      const res = await repository.obtenerPorId(1, 99);
      expect(res).toBeNull();
    });
  });

  describe('actualizar', () => {
    it('actualiza los campos indicados', async () => {
      await repository.actualizar(1, 10, {
        url: 'https://instagram.com/actualizado',
      });
      expect(prisma.redSocialNegocio.update).toHaveBeenCalledWith({
        where: { negocioId_id: { negocioId: 1, id: 10 } },
        data: { url: 'https://instagram.com/actualizado' },
        select: expect.any(Object),
      });
    });
  });

  describe('desactivar', () => {
    it('establece activo = false', async () => {
      await repository.desactivar(1, 10);
      expect(prisma.redSocialNegocio.update).toHaveBeenCalledWith({
        where: { negocioId_id: { negocioId: 1, id: 10 } },
        data: { activo: false },
        select: expect.any(Object),
      });
    });
  });

  describe('activar', () => {
    it('establece activo = true', async () => {
      await repository.activar(1, 10);
      expect(prisma.redSocialNegocio.update).toHaveBeenCalledWith({
        where: { negocioId_id: { negocioId: 1, id: 10 } },
        data: { activo: true },
        select: expect.any(Object),
      });
    });
  });

  describe('eliminarFisico', () => {
    it('elimina permanentemente el registro', async () => {
      await repository.eliminarFisico(1, 10);
      expect(prisma.redSocialNegocio.delete).toHaveBeenCalledWith({
        where: { negocioId_id: { negocioId: 1, id: 10 } },
        select: expect.any(Object),
      });
    });
  });

  describe('existeOtraActivaConMismaClave', () => {
    it('devuelve true si encuentra otra red activa con la misma clave', async () => {
      (prisma.redSocialNegocio.findFirst as jest.Mock).mockResolvedValue({
        id: 20,
      });
      const res = await repository.existeOtraActivaConMismaClave(
        1,
        10,
        TipoRedSocial.OTRO,
        'MiRed',
      );
      expect(res).toBe(true);
    });

    it('devuelve false si no encuentra otra red activa', async () => {
      (prisma.redSocialNegocio.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await repository.existeOtraActivaConMismaClave(
        1,
        10,
        TipoRedSocial.OTRO,
        'MiRed',
      );
      expect(res).toBe(false);
    });
  });
});

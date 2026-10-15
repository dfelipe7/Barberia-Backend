import { Test, TestingModule } from '@nestjs/testing';
import { CierresGeneralesRepository } from './cierres-generales.repository';
import { PrismaService } from '../../../prisma/prisma.service';

const mockPrismaService = {
  generalClosure: {
    findMany: jest.fn(),
  },
};

describe('CierresGeneralesRepository', () => {
  let repository: CierresGeneralesRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CierresGeneralesRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<CierresGeneralesRepository>(
      CierresGeneralesRepository,
    );
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  it('debe consultar solo los cierres activos de la fecha', async () => {
    const fecha = new Date('2026-10-20T00:00:00.000Z');
    mockPrismaService.generalClosure.findMany.mockResolvedValue([{ id: 1 }]);

    const resultado = await repository.obtenerActivosEnFecha(fecha);

    expect(mockPrismaService.generalClosure.findMany).toHaveBeenCalledWith({
      where: { date: fecha, active: true },
    });
    expect(resultado).toEqual([{ id: 1 }]);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { CierresGeneralesRepository } from './cierres-generales.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import {
  CONTEXTO_NEGOCIO_A,
  crearAislamientoNegocio,
} from '../../negocios/negocio-aislamiento.test-helpers';

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
        {
          provide: NegocioAislamientoService,
          useValue: crearAislamientoNegocio(),
        },
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

  it('debe consultar solo los cierres activos de la fecha y del negocio activo', async () => {
    const fecha = new Date('2026-10-20T00:00:00.000Z');
    mockPrismaService.generalClosure.findMany.mockResolvedValue([{ id: 1 }]);

    const resultado = await repository.obtenerActivosEnFecha(fecha);

    expect(mockPrismaService.generalClosure.findMany).toHaveBeenCalledWith({
      where: { date: fecha, active: true, negocioId: CONTEXTO_NEGOCIO_A.id },
    });
    expect(resultado).toEqual([{ id: 1 }]);
  });
});

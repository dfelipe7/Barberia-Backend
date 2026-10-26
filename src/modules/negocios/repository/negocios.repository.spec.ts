import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegociosRepository } from './negocios.repository';

const mockPrismaService = {
  negocio: {
    findFirst: jest.fn(),
  },
};

describe('NegociosRepository', () => {
  let repository: NegociosRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NegociosRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<NegociosRepository>(NegociosRepository);
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  it('busca el negocio por slug exigiendo estado ACTIVO', async () => {
    const negocio = { id: 1, slug: 'kyrios' };
    mockPrismaService.negocio.findFirst.mockResolvedValue(negocio);

    const resultado = await repository.buscarActivoPorSlug('kyrios');

    expect(mockPrismaService.negocio.findFirst).toHaveBeenCalledWith({
      where: { slug: 'kyrios', estado: 'ACTIVO' },
      select: { id: true, slug: true },
    });
    expect(resultado).toEqual(negocio);
  });

  it('devuelve null si el negocio no existe o está inactivo', async () => {
    mockPrismaService.negocio.findFirst.mockResolvedValue(null);

    await expect(repository.buscarActivoPorSlug('kyrios')).resolves.toBeNull();
  });
});

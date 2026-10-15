import { Test, TestingModule } from '@nestjs/testing';
import { ClientesRepository } from './clientes.repository';
import { PrismaService } from '../../../prisma/prisma.service';

const mockPrismaService = {
  cliente: {
    findUnique: jest.fn(),
  },
};

describe('ClientesRepository', () => {
  let repository: ClientesRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientesRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<ClientesRepository>(ClientesRepository);
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  it('busca el cliente por usuarioId', async () => {
    mockPrismaService.cliente.findUnique.mockResolvedValue({ id: 55 });

    const resultado = await repository.buscarPorUsuarioId(9);

    expect(resultado).toEqual({ id: 55 });
    expect(mockPrismaService.cliente.findUnique).toHaveBeenCalledWith({
      where: { usuarioId: 9 },
    });
  });

  it('devuelve null cuando el usuario no tiene cliente asociado', async () => {
    mockPrismaService.cliente.findUnique.mockResolvedValue(null);

    await expect(repository.buscarPorUsuarioId(9)).resolves.toBeNull();
  });
});

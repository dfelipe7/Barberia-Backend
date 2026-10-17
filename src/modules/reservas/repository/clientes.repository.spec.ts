import { Test, TestingModule } from '@nestjs/testing';
import { ClientesRepository } from './clientes.repository';
import { PrismaService } from '../../../prisma/prisma.service';

const mockPrismaService = {
  cliente: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
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

  it('busca el cliente por googleId', async () => {
    mockPrismaService.cliente.findUnique.mockResolvedValue({ id: 7 });

    await expect(repository.buscarPorGoogleId('google-sub')).resolves.toEqual({
      id: 7,
    });
    expect(mockPrismaService.cliente.findUnique).toHaveBeenCalledWith({
      where: { googleId: 'google-sub' },
    });
  });

  describe('buscarOcrearPorGoogle', () => {
    const datos = {
      googleId: 'google-sub',
      email: 'cliente@gmail.com',
      nombre: 'Ana',
      apellido: 'Pérez',
    };

    it('reutiliza y refresca el cliente existente sin crear otro', async () => {
      mockPrismaService.cliente.findUnique.mockResolvedValue({ id: 7 });
      mockPrismaService.cliente.update.mockResolvedValue({ id: 7 });

      const resultado = await repository.buscarOcrearPorGoogle(datos);

      expect(resultado).toEqual({ id: 7 });
      expect(mockPrismaService.cliente.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: {
          nombre: 'Ana',
          apellido: 'Pérez',
          email: 'cliente@gmail.com',
        },
      });
      expect(mockPrismaService.cliente.create).not.toHaveBeenCalled();
    });

    it('crea el cliente cuando no existe para ese googleId', async () => {
      mockPrismaService.cliente.findUnique.mockResolvedValue(null);
      mockPrismaService.cliente.create.mockResolvedValue({ id: 8 });

      await expect(repository.buscarOcrearPorGoogle(datos)).resolves.toEqual({
        id: 8,
      });
      expect(mockPrismaService.cliente.create).toHaveBeenCalledWith({
        data: {
          googleId: 'google-sub',
          email: 'cliente@gmail.com',
          nombre: 'Ana',
          apellido: 'Pérez',
        },
      });
    });

    it('ante una carrera de unicidad (P2002) devuelve el cliente ya creado', async () => {
      mockPrismaService.cliente.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 9 });
      mockPrismaService.cliente.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 'P2002' }),
      );

      await expect(repository.buscarOcrearPorGoogle(datos)).resolves.toEqual({
        id: 9,
      });
    });

    it('propaga el error si no es una violación de unicidad', async () => {
      mockPrismaService.cliente.findUnique.mockResolvedValue(null);
      mockPrismaService.cliente.create.mockRejectedValue(new Error('db down'));

      await expect(repository.buscarOcrearPorGoogle(datos)).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('buscarClientes (HU-13)', () => {
    it('devuelve una lista vacía si el término está vacío o solo contiene espacios', async () => {
      const resVacio = await repository.buscarClientes('');
      const resEspacios = await repository.buscarClientes('   ');

      expect(resVacio).toEqual([]);
      expect(resEspacios).toEqual([]);
      expect(mockPrismaService.cliente.findMany).not.toHaveBeenCalled();
    });

    it('busca clientes por nombre, apellido, teléfono o email aplicando trim y orden alfabético', async () => {
      const mockClientes = [
        {
          id: 1,
          nombre: 'Carlos',
          apellido: 'Gómez',
          telefono: '3119998877',
          email: 'carlos@mail.com',
        },
      ];
      mockPrismaService.cliente.findMany = jest
        .fn()
        .mockResolvedValue(mockClientes);

      const resultado = await repository.buscarClientes('  Carlos  ');

      expect(mockPrismaService.cliente.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { nombre: { contains: 'Carlos' } },
            { apellido: { contains: 'Carlos' } },
            { telefono: { contains: 'Carlos' } },
            { email: { contains: 'Carlos' } },
          ],
        },
        take: 20,
        orderBy: { nombre: 'asc' },
      });
      expect(resultado).toBe(mockClientes);
    });
  });
});

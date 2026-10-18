import { Test, TestingModule } from '@nestjs/testing';
import { ConfiguracionRepository } from './configuracion.repository';
import { PrismaService } from '../../../prisma/prisma.service';

const mockPrismaService = {
  configuracionSistema: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('ConfiguracionRepository', () => {
  let repository: ConfiguracionRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfiguracionRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<ConfiguracionRepository>(ConfiguracionRepository);
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  it('devuelve el registro por clave con selección explícita de campos', async () => {
    const registro = {
      clave: 'reserva_no_show_tolerancia_minutos',
      valor: '15',
      tipo: 'NUMERO',
      editable: true,
    };
    mockPrismaService.configuracionSistema.findUnique.mockResolvedValue(
      registro,
    );

    const resultado = await repository.buscarPorClave(
      'reserva_no_show_tolerancia_minutos',
    );

    expect(
      mockPrismaService.configuracionSistema.findUnique,
    ).toHaveBeenCalledWith({
      where: { clave: 'reserva_no_show_tolerancia_minutos' },
      select: { clave: true, valor: true, tipo: true, editable: true },
    });
    expect(resultado).toEqual(registro);
  });

  it('devuelve null si la clave no existe', async () => {
    mockPrismaService.configuracionSistema.findUnique.mockResolvedValue(null);

    await expect(
      repository.buscarPorClave('clave_inexistente'),
    ).resolves.toBeNull();
  });

  it('lista las configuraciones ordenadas por clave', async () => {
    const registros = [
      {
        clave: 'reserva_cancelacion_antelacion_minutos',
        valor: '120',
        tipo: 'NUMERO',
        editable: true,
      },
      {
        clave: 'reserva_no_show_tolerancia_minutos',
        valor: '15',
        tipo: 'NUMERO',
        editable: true,
      },
    ];
    mockPrismaService.configuracionSistema.findMany.mockResolvedValue(
      registros,
    );

    const resultado = await repository.listar();

    expect(
      mockPrismaService.configuracionSistema.findMany,
    ).toHaveBeenCalledWith({
      select: { clave: true, valor: true, tipo: true, editable: true },
      orderBy: { clave: 'asc' },
    });
    expect(resultado).toEqual(registros);
  });
});

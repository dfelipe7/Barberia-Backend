import { Test, TestingModule } from '@nestjs/testing';
import { ConfiguracionRepository } from './configuracion.repository';
import { PrismaService } from '../../../prisma/prisma.service';

const mockPrismaService = {
  configuracionSistema: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  configuracionNegocio: {
    findFirst: jest.fn(),
    create: jest.fn(),
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

  describe('ámbito de negocio', () => {
    it('busca la configuración exigiendo negocioId y clave en la condición', async () => {
      const registro = {
        clave: 'reserva_no_show_tolerancia_minutos',
        valor: '15',
        tipo: 'NUMERO',
        editable: true,
      };
      mockPrismaService.configuracionNegocio.findFirst.mockResolvedValue(
        registro,
      );

      const resultado = await repository.buscarPorClaveEnNegocio(
        7,
        'reserva_no_show_tolerancia_minutos',
      );

      expect(
        mockPrismaService.configuracionNegocio.findFirst,
      ).toHaveBeenCalledWith({
        where: {
          negocioId: 7,
          clave: 'reserva_no_show_tolerancia_minutos',
        },
        select: { clave: true, valor: true, tipo: true, editable: true },
      });
      expect(resultado).toEqual(registro);
    });

    it('devuelve null si el negocio no tiene la clave', async () => {
      mockPrismaService.configuracionNegocio.findFirst.mockResolvedValue(null);

      await expect(
        repository.buscarPorClaveEnNegocio(7, 'clave'),
      ).resolves.toBeNull();
    });
  });

  describe('inicialización idempotente', () => {
    it('crea solo las claves que faltan y conserva las existentes', async () => {
      mockPrismaService.configuracionNegocio.findFirst
        // La primera clave ya existe; la segunda no.
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce(null);
      mockPrismaService.configuracionNegocio.create.mockResolvedValue({});

      const resultado = await repository.inicializarValoresOperativos(7);

      expect(resultado.conservadas).toEqual([
        'reserva_cancelacion_antelacion_minutos',
      ]);
      expect(resultado.creadas).toEqual(['reserva_no_show_tolerancia_minutos']);
      expect(
        mockPrismaService.configuracionNegocio.create,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockPrismaService.configuracionNegocio.create,
      ).toHaveBeenCalledWith({
        data: {
          negocioId: 7,
          clave: 'reserva_no_show_tolerancia_minutos',
          valor: '15',
          tipo: 'NUMERO',
          descripcion:
            'Minutos de tolerancia tras la hora de inicio antes de poder marcar una reserva como NO_SHOW.',
          editable: true,
        },
      });
    });

    it('no sobrescribe el valor de una clave ya existente', async () => {
      mockPrismaService.configuracionNegocio.findFirst.mockResolvedValue({
        id: 1,
      });

      const resultado = await repository.inicializarValoresOperativos(7);

      expect(resultado.creadas).toEqual([]);
      expect(
        mockPrismaService.configuracionNegocio.create,
      ).not.toHaveBeenCalled();
    });
  });
});

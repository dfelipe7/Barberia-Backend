import { Test, TestingModule } from '@nestjs/testing';
import { HorariosRepository } from './horarios.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { crearAislamientoNegocio } from '../../negocios/negocio-aislamiento.test-helpers';

jest.mock('../../../../generated/prisma/enums', () => ({
  WeekDay: {
    MONDAY: 'MONDAY',
    TUESDAY: 'TUESDAY',
    WEDNESDAY: 'WEDNESDAY',
    THURSDAY: 'THURSDAY',
    FRIDAY: 'FRIDAY',
    SATURDAY: 'SATURDAY',
    SUNDAY: 'SUNDAY',
  },
}));

import { WeekDay } from '../../../../generated/prisma/enums';

const mockPrismaService = {
  barberWeeklySlot: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

/** Negocio activo usado por las pruebas de repositorio. */
const NEGOCIO_ACTIVO = 1;

/**
 * Elimina el `negocioId` de un valor, en todas las posiciones en las que
 * el aislamiento puede inyectarlo (`where`, `data` y los `data.create` /
 * `data.update` del upsert).
 */
const sinNegocio = (valor: unknown): unknown => {
  if (Array.isArray(valor)) {
    return valor.map(sinNegocio);
  }

  if (valor === null || typeof valor !== 'object') {
    return valor;
  }

  // Una `Date` (u otro objeto sin propiedades enumerables) se devuelve tal
  // cual: recorrerla la convertiría en `{}` y la comparación fallaría.
  if (valor instanceof Date) {
    return valor;
  }

  const entrada = valor as Record<string, unknown>;
  const salida: Record<string, unknown> = {};

  for (const [clave, contenido] of Object.entries(entrada)) {
    if (clave === 'negocioId') {
      continue;
    }
    salida[clave] = sinNegocio(contenido);
  }

  return salida;
};

/**
 * Recorre un valor y devuelve todos los `negocioId` que encuentra.
 */
const negocioIdsDe = (valor: unknown): unknown[] => {
  if (Array.isArray(valor)) {
    return valor.flatMap(negocioIdsDe);
  }

  if (valor === null || typeof valor !== 'object') {
    return [];
  }

  const entrada = valor as Record<string, unknown>;
  const encontrados: unknown[] = [];

  for (const [clave, contenido] of Object.entries(entrada)) {
    if (clave === 'negocioId') {
      encontrados.push(contenido);
      continue;
    }
    encontrados.push(...negocioIdsDe(contenido));
  }

  return encontrados;
};

/**
 * Verifica que una llamada de Prisma corresponde a la consulta esperada, una
 * vez APLICADO el aislamiento multitenant.
 *
 * La consulta esperada por las pruebas existentes describe la consulta SIN
 * el filtro de negocio. Con el aislamiento, la consulta real incluye además
 * el `negocioId` del negocio activo. Esta función compara ambas ignorando
 * ese campo, y exige que TODOS los `negocioId` de la consulta real sean el
 * del negocio activo: si el repositorio consultara o escribiera con otro
 * negocio (o sin filtro), la aserción fallaría.
 */
/**
 * Detecta el marcador `expect.objectContaining(...)`, que Jest expone con
 * las propiedades `sample` e `inverse`.
 */
const esObjectContaining = (valor: unknown): boolean =>
  valor !== null &&
  typeof valor === 'object' &&
  'sample' in (valor as Record<string, unknown>) &&
  'inverse' in (valor as Record<string, unknown>);

/**
 * Compara la consulta real con la esperada, admitiendo que la esperada use
 * `expect.objectContaining(...)` (que Jest no sabe comparar con
 * `toEqual`): en ese caso se compara contra los CAMPOS que declara.
 */
const coincideConEsperado = (real: unknown, esperado: unknown): boolean => {
  if (esObjectContaining(esperado)) {
    const campos = (esperado as { sample: Record<string, unknown> }).sample;
    const realObj = (real ?? {}) as Record<string, unknown>;

    for (const [clave, valor] of Object.entries(campos)) {
      if (!coincideConEsperado(realObj[clave], valor)) {
        return false;
      }
    }

    return true;
  }

  if (Array.isArray(esperado)) {
    if (!Array.isArray(real) || real.length !== esperado.length) {
      return false;
    }
    return esperado.every((item, i) => coincideConEsperado(real[i], item));
  }

  if (esperado === null || typeof esperado !== 'object') {
    return JSON.stringify(real) === JSON.stringify(esperado);
  }

  const esperadoObj = esperado as Record<string, unknown>;
  const realObj = (real ?? {}) as Record<string, unknown>;

  for (const [clave, valor] of Object.entries(esperadoObj)) {
    if (!coincideConEsperado(realObj[clave], valor)) {
      return false;
    }
  }

  return true;
};

const esperarConsultaAislada = (mock: unknown, esperado: unknown): void => {
  const registro = (mock as { mock?: { calls?: unknown[][] } } | undefined)
    ?.mock;
  const llamadas = registro?.calls ?? [];

  const coincide = llamadas.some((args) => {
    try {
      expect(args.map(sinNegocio)).toEqual([esperado]);
      return true;
    } catch {
      // El marcador `objectContaining` no se puede comparar con
      // `toEqual`: se compara campo a campo.
      return args.length === 1 && coincideConEsperado(args[0], esperado);
    }
  });

  if (!coincide) {
    throw new Error(
      `Esperado (ignorando negocioId): ${JSON.stringify(esperado)}\n` +
        `Llamadas recibidas: ${JSON.stringify(llamadas)}`,
    );
  }

  for (const args of llamadas) {
    for (const negocioId of args.flatMap(negocioIdsDe)) {
      if (negocioId !== NEGOCIO_ACTIVO) {
        throw new Error(
          `La consulta usa el negocio ${String(
            negocioId,
          )} en lugar del negocio activo ${NEGOCIO_ACTIVO}`,
        );
      }
    }
  }
};

describe('HorariosRepository', () => {
  let repository: HorariosRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HorariosRepository,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: NegocioAislamientoService,
          useValue: crearAislamientoNegocio(),
        },
      ],
    }).compile();

    repository = module.get<HorariosRepository>(HorariosRepository);
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  describe('obtenerFranjasActivasPorBarbero', () => {
    it('debe consultar solo las franjas activas ordenadas por día y hora', async () => {
      mockPrismaService.barberWeeklySlot.findMany.mockResolvedValue([
        { id: 1 },
      ]);

      const resultado = await repository.obtenerFranjasActivasPorBarbero(5);

      esperarConsultaAislada(mockPrismaService.barberWeeklySlot.findMany, {
        where: { barberoId: 5, active: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
      expect(resultado).toEqual([{ id: 1 }]);
    });
  });

  describe('obtenerFranjasActivasPorBarberoYDia', () => {
    it('debe consultar las franjas activas del barbero para un día concreto', async () => {
      mockPrismaService.barberWeeklySlot.findMany.mockResolvedValue([
        { id: 1 },
      ]);

      const resultado = await repository.obtenerFranjasActivasPorBarberoYDia(
        5,
        WeekDay.MONDAY,
      );

      esperarConsultaAislada(mockPrismaService.barberWeeklySlot.findMany, {
        where: { barberoId: 5, dayOfWeek: WeekDay.MONDAY, active: true },
        orderBy: { startTime: 'asc' },
      });
      expect(resultado).toEqual([{ id: 1 }]);
    });
  });

  describe('reemplazarFranjas', () => {
    it('debe desactivar las franjas activas y hacer upsert de las recibidas en una transacción', async () => {
      mockPrismaService.$transaction.mockResolvedValue([]);
      mockPrismaService.barberWeeklySlot.findMany.mockResolvedValue([
        { id: 9 },
      ]);

      const franjas = [
        { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
      ];

      const resultado = await repository.reemplazarFranjas(3, franjas);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      const operaciones = mockPrismaService.$transaction.mock
        .calls[0][0] as unknown[];
      expect(operaciones).toHaveLength(2);
      esperarConsultaAislada(mockPrismaService.barberWeeklySlot.updateMany, {
        where: { barberoId: 3, active: true },
        data: { active: false },
      });
      esperarConsultaAislada(mockPrismaService.barberWeeklySlot.upsert, {
        where: {
          barberoId_dayOfWeek_startTime: {
            barberoId: 3,
            dayOfWeek: WeekDay.MONDAY,
            startTime: '09:00',
          },
        },
        update: { endTime: '10:00', active: true },
        create: {
          barberoId: 3,
          dayOfWeek: WeekDay.MONDAY,
          startTime: '09:00',
          endTime: '10:00',
          active: true,
        },
      });
      expect(resultado).toEqual([{ id: 9 }]);
    });

    it('debe desactivar todas las franjas y no hacer upsert cuando la lista está vacía', async () => {
      mockPrismaService.$transaction.mockResolvedValue([]);
      mockPrismaService.barberWeeklySlot.findMany.mockResolvedValue([]);

      const resultado = await repository.reemplazarFranjas(3, []);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      const operaciones = mockPrismaService.$transaction.mock
        .calls[0][0] as unknown[];
      expect(operaciones).toHaveLength(1);
      esperarConsultaAislada(mockPrismaService.barberWeeklySlot.updateMany, {
        where: { barberoId: 3, active: true },
        data: { active: false },
      });
      expect(mockPrismaService.barberWeeklySlot.upsert).not.toHaveBeenCalled();
      expect(resultado).toEqual([]);
    });
  });
});

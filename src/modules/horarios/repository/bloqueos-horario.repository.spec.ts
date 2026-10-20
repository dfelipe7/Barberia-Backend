import { Test, TestingModule } from '@nestjs/testing';
import { BloqueosHorarioRepository } from './bloqueos-horario.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { crearAislamientoNegocio } from '../../negocios/negocio-aislamiento.test-helpers';

jest.mock('../../../../generated/prisma/enums', () => ({
  ScheduleBlockStatus: {
    ACTIVE: 'ACTIVE',
    REACTIVATED: 'REACTIVATED',
    CANCELLED: 'CANCELLED',
  },
  ScheduleBlockReason: {
    PERSONAL: 'PERSONAL',
    MEDICAL: 'MEDICAL',
    VACATION: 'VACATION',
    OTHER: 'OTHER',
  },
}));

import {
  ScheduleBlockReason,
  ScheduleBlockStatus,
} from '../../../../generated/prisma/enums';

const mockPrismaService = {
  barberScheduleBlock: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
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
const esperarConsultaAislada = (mock: unknown, esperado: unknown): void => {
  const registro = (mock as { mock?: { calls?: unknown[][] } } | undefined)
    ?.mock;
  const llamadas = registro?.calls ?? [];

  console.log(
    'DEBUG real:',
    JSON.stringify(llamadas.map((a) => a.map(sinNegocio))),
    'esperado:',
    JSON.stringify([esperado]),
  );
  const coincide = llamadas.some((args) => {
    try {
      expect(args.map(sinNegocio)).toEqual([esperado]);
      return true;
    } catch {
      return false;
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

describe('BloqueosHorarioRepository', () => {
  let repository: BloqueosHorarioRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BloqueosHorarioRepository,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: NegocioAislamientoService,
          useValue: crearAislamientoNegocio(),
        },
      ],
    }).compile();

    repository = module.get<BloqueosHorarioRepository>(
      BloqueosHorarioRepository,
    );
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  describe('crear', () => {
    it('debe crear un bloqueo ACTIVE con los datos recibidos', async () => {
      const fecha = new Date('2026-10-20T00:00:00.000Z');
      mockPrismaService.barberScheduleBlock.create.mockResolvedValue({ id: 1 });

      const resultado = await repository.crear({
        barberoId: 7,
        date: fecha,
        startTime: '15:00',
        endTime: '16:00',
        reason: ScheduleBlockReason.PERSONAL,
        notes: 'Cita personal',
      });

      esperarConsultaAislada(mockPrismaService.barberScheduleBlock.create, {
        data: {
          barberoId: 7,
          date: fecha,
          startTime: '15:00',
          endTime: '16:00',
          reason: ScheduleBlockReason.PERSONAL,
          notes: 'Cita personal',
          status: ScheduleBlockStatus.ACTIVE,
        },
      });
      expect(resultado).toEqual({ id: 1 });
    });
  });

  describe('obtenerPorId', () => {
    it('debe consultar un bloqueo por id', async () => {
      mockPrismaService.barberScheduleBlock.findFirst.mockResolvedValue({
        id: 3,
      });

      const resultado = await repository.obtenerPorId(3);

      esperarConsultaAislada(mockPrismaService.barberScheduleBlock.findFirst, {
        where: { id: 3 },
      });
      expect(resultado).toEqual({ id: 3 });
    });
  });

  describe('listarPorBarbero', () => {
    it('debe filtrar por fecha y estado cuando se envían, ordenando por fecha y hora', async () => {
      const fecha = new Date('2026-10-20T00:00:00.000Z');
      mockPrismaService.barberScheduleBlock.findMany.mockResolvedValue([]);

      await repository.listarPorBarbero(7, {
        date: fecha,
        status: ScheduleBlockStatus.ACTIVE,
      });

      esperarConsultaAislada(mockPrismaService.barberScheduleBlock.findMany, {
        where: {
          barberoId: 7,
          date: fecha,
          status: ScheduleBlockStatus.ACTIVE,
        },
        orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
      });
    });

    it('no debe incluir filtros cuando no se envían', async () => {
      mockPrismaService.barberScheduleBlock.findMany.mockResolvedValue([]);

      await repository.listarPorBarbero(7);

      esperarConsultaAislada(mockPrismaService.barberScheduleBlock.findMany, {
        where: { barberoId: 7 },
        orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
      });
    });
  });

  describe('listarActivosPorBarberoYFecha', () => {
    it('debe consultar solo bloqueos ACTIVE del barbero en la fecha', async () => {
      const fecha = new Date('2026-10-20T00:00:00.000Z');
      mockPrismaService.barberScheduleBlock.findMany.mockResolvedValue([]);

      await repository.listarActivosPorBarberoYFecha(7, fecha);

      esperarConsultaAislada(mockPrismaService.barberScheduleBlock.findMany, {
        where: {
          barberoId: 7,
          date: fecha,
          status: ScheduleBlockStatus.ACTIVE,
        },
      });
    });
  });

  describe('actualizar', () => {
    it('debe actualizar el bloqueo con los datos recibidos', async () => {
      mockPrismaService.barberScheduleBlock.update.mockResolvedValue({ id: 3 });

      const resultado = await repository.actualizar(3, {
        status: ScheduleBlockStatus.CANCELLED,
      });

      esperarConsultaAislada(mockPrismaService.barberScheduleBlock.update, {
        where: { id: 3 },
        data: { status: ScheduleBlockStatus.CANCELLED },
      });
      expect(resultado).toEqual({ id: 3 });
    });
  });
});

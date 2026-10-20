import { Test, TestingModule } from '@nestjs/testing';
import { AdministradoresRepository } from './administradores.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { crearAislamientoNegocio } from '../../negocios/negocio-aislamiento.test-helpers';

const mockPrismaService = {
  administrador: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
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

describe('AdministradoresRepository', () => {
  let repository: AdministradoresRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdministradoresRepository,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: NegocioAislamientoService,
          useValue: crearAislamientoNegocio(),
        },
      ],
    }).compile();

    repository = module.get<AdministradoresRepository>(
      AdministradoresRepository,
    );
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('crearAdministrador', () => {
    it('should create an administrator', async () => {
      const data = { usuarioId: 1 };
      mockPrismaService.administrador.create.mockResolvedValue({
        usuarioId: 1,
        estado: 'ACTIVO',
      });

      const result = await repository.crearAdministrador(data);

      esperarConsultaAislada(mockPrismaService.administrador.create, { data });
      expect(result).toEqual({ usuarioId: 1, estado: 'ACTIVO' });
    });
  });

  describe('obtenerAdministradores', () => {
    it('should return a list of administrators without filters', async () => {
      mockPrismaService.administrador.findMany.mockResolvedValue([
        { usuarioId: 1 },
      ]);
      const result = await repository.obtenerAdministradores();

      expect(prisma.administrador.findMany).toHaveBeenCalled();
      expect(result).toEqual([{ usuarioId: 1 }]);
    });

    it('should return a list of active administrators with ACTIVO filter', async () => {
      mockPrismaService.administrador.findMany.mockResolvedValue([
        { usuarioId: 1 },
      ]);
      await repository.obtenerAdministradores({ estado: 'ACTIVO' });

      esperarConsultaAislada(mockPrismaService.administrador.findMany, {
        where: {
          usuario: {
            rol: { not: 'SUPERADMIN' },
            estado: 'ACTIVO',
          },
          estado: 'ACTIVO',
        },
        include: expect.any(Object),
      });
    });

    it('should return a list of administrators with INACTIVO filter', async () => {
      mockPrismaService.administrador.findMany.mockResolvedValue([
        { usuarioId: 1 },
      ]);
      await repository.obtenerAdministradores({ estado: 'INACTIVO' });

      esperarConsultaAislada(mockPrismaService.administrador.findMany, {
        where: {
          usuario: {
            rol: { not: 'SUPERADMIN' },
          },
          OR: [{ estado: 'INACTIVO' }, { usuario: { estado: 'INACTIVO' } }],
        },
        include: expect.any(Object),
      });
    });

    it('should return a list of administrators filtered by nombre', async () => {
      mockPrismaService.administrador.findMany.mockResolvedValue([
        { usuarioId: 1 },
      ]);
      await repository.obtenerAdministradores({ nombre: 'Juan' });

      esperarConsultaAislada(mockPrismaService.administrador.findMany, {
        where: {
          usuario: {
            rol: { not: 'SUPERADMIN' },
            OR: [
              { nombre: { contains: 'Juan' } },
              { apellido: { contains: 'Juan' } },
              { email: { contains: 'Juan' } },
            ],
          },
        },
        include: expect.any(Object),
      });
    });
  });

  describe('actualizarEstadoAdministrador', () => {
    it('should update administrator state', async () => {
      mockPrismaService.administrador.update.mockResolvedValue({
        usuarioId: 1,
        estado: 'INACTIVO',
      });

      const result = await repository.actualizarEstadoAdministrador(
        1,
        'INACTIVO',
      );

      esperarConsultaAislada(mockPrismaService.administrador.update, {
        where: { usuarioId: 1 },
        data: { estado: 'INACTIVO' },
      });
      expect(result).toEqual({ usuarioId: 1, estado: 'INACTIVO' });
    });
  });

  describe('obtenerAdministradorPorUsuarioId', () => {
    it('should return an administrator by user ID', async () => {
      mockPrismaService.administrador.findFirst.mockResolvedValue({
        usuarioId: 1,
      });

      const result = await repository.obtenerAdministradorPorUsuarioId(1);

      esperarConsultaAislada(mockPrismaService.administrador.findFirst, {
        where: { usuarioId: 1 },
      });
      expect(result).toEqual({ usuarioId: 1 });
    });
  });
});

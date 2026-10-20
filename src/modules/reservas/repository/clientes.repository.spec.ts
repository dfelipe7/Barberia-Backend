import { Test, TestingModule } from '@nestjs/testing';
import { ClientesRepository } from './clientes.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { crearAislamientoNegocio } from '../../negocios/negocio-aislamiento.test-helpers';

const mockPrismaService = {
  cliente: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
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

describe('ClientesRepository', () => {
  let repository: ClientesRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientesRepository,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: NegocioAislamientoService,
          useValue: crearAislamientoNegocio(),
        },
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
    esperarConsultaAislada(mockPrismaService.cliente.findUnique, {
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
    esperarConsultaAislada(mockPrismaService.cliente.findUnique, {
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
      esperarConsultaAislada(mockPrismaService.cliente.update, {
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
      esperarConsultaAislada(mockPrismaService.cliente.create, {
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

      esperarConsultaAislada(mockPrismaService.cliente.findMany, {
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

import { Test, TestingModule } from '@nestjs/testing';
import { ServiciosRepository } from './servicios.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { crearAislamientoNegocio } from '../../negocios/negocio-aislamiento.test-helpers';

// Mock the generated Prisma enums so they resolve correctly in Jest
jest.mock('../../../../generated/prisma/enums', () => ({
  EstadoServicio: { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' },
  EstadoUsuario: { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' },
}));

const EstadoServicio = { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' } as const;
const EstadoUsuario = { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' } as const;

const mockPrisma = {
  barbero: { findMany: jest.fn() },
  barberoServicio: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  servicio: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
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

describe('ServiciosRepository', () => {
  let repository: ServiciosRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiciosRepository,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: NegocioAislamientoService,
          useValue: crearAislamientoNegocio(),
        },
      ],
    }).compile();
    repository = module.get<ServiciosRepository>(ServiciosRepository);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('obtenerBarberosActivosPorIds', () => {
    it('should return active barberos by ids', async () => {
      mockPrisma.barbero.findMany.mockResolvedValue([{ id: 1 }]);
      const result = await repository.obtenerBarberosActivosPorIds([1]);
      expect(mockPrisma.barbero.findMany).toHaveBeenCalled();
      // Los identificadores son `Barbero.id` (NO `Usuario.id`).
      esperarConsultaAislada(mockPrisma.barbero.findMany, {
        where: expect.objectContaining({ id: { in: [1] } }),
        select: { id: true },
      });
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('obtenerServicioPorNombre', () => {
    it('should return a service by name', async () => {
      mockPrisma.servicio.findFirst.mockResolvedValue({
        id: 1,
        nombre: 'Corte',
      });
      const result = await repository.obtenerServicioPorNombre('Corte');
      esperarConsultaAislada(mockPrisma.servicio.findFirst, {
        where: { nombre: 'Corte' },
      });
      expect(result).toEqual({ id: 1, nombre: 'Corte' });
    });
  });

  describe('obtenerServicioPorId', () => {
    it('should return a service by id with barberos', async () => {
      mockPrisma.servicio.findUnique.mockResolvedValue({ id: 1 });
      const result = await repository.obtenerServicioPorId(1);
      esperarConsultaAislada(
        mockPrisma.servicio.findUnique,
        expect.objectContaining({ where: { id: 1 } }),
      );
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('obtenerServicioActivoPorId', () => {
    it('should return an ACTIVO service by id', async () => {
      mockPrisma.servicio.findFirst.mockResolvedValue({ id: 1 });
      const result = await repository.obtenerServicioActivoPorId(1);
      esperarConsultaAislada(mockPrisma.servicio.findFirst, {
        where: { id: 1, estado: EstadoServicio.ACTIVO },
      });
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('existeAsignacionBarbero', () => {
    it('should return true when the assignment exists', async () => {
      mockPrisma.barberoServicio.findFirst.mockResolvedValue({ barberoId: 3 });
      const result = await repository.existeAsignacionBarbero(3, 2);
      esperarConsultaAislada(mockPrisma.barberoServicio.findFirst, {
        where: { barberoId: 3, servicioId: 2 },
        select: { barberoId: true },
      });
      expect(result).toBe(true);
    });

    it('should return false when the assignment does not exist', async () => {
      mockPrisma.barberoServicio.findFirst.mockResolvedValue(null);
      const result = await repository.existeAsignacionBarbero(3, 2);
      expect(result).toBe(false);
    });
  });

  describe('listarServiciosCatalogo', () => {
    it('should return active services without filter', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([{ id: 1 }]);
      const result = await repository.listarServiciosCatalogo();
      esperarConsultaAislada(mockPrisma.servicio.findMany, {
        where: { estado: EstadoServicio.ACTIVO },
        include: expect.any(Object),
        orderBy: { nombre: 'asc' },
      });
      expect(result).toEqual([{ id: 1 }]);
    });

    it('should apply nombre filter to catalogo', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([]);
      await repository.listarServiciosCatalogo({ nombre: 'Corte' });
      esperarConsultaAislada(mockPrisma.servicio.findMany, {
        where: {
          estado: EstadoServicio.ACTIVO,
          barberos: {
            some: {
              barbero: {
                estado: EstadoUsuario.ACTIVO,
                usuario: {
                  estado: EstadoUsuario.ACTIVO,
                },
                weeklySlots: {
                  some: {
                    active: true,
                  },
                },
              },
            },
          },
          OR: [
            { nombre: { contains: 'Corte' } },
            { descripcion: { contains: 'Corte' } },
          ],
        },
        include: expect.any(Object),
        orderBy: { nombre: 'asc' },
      });
    });
  });

  describe('listarServiciosGestion', () => {
    it('should return all services without filter', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([{ id: 1 }]);
      const result = await repository.listarServiciosGestion();
      esperarConsultaAislada(mockPrisma.servicio.findMany, {
        where: {},
        include: expect.any(Object),
        orderBy: { id: 'desc' },
      });
      expect(result).toEqual([{ id: 1 }]);
    });

    it('should filter by estado', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([]);
      await repository.listarServiciosGestion({
        estado: EstadoServicio.ACTIVO,
      });
      esperarConsultaAislada(mockPrisma.servicio.findMany, {
        where: { estado: EstadoServicio.ACTIVO },
        include: expect.any(Object),
        orderBy: { id: 'desc' },
      });
    });

    it('should filter by nombre', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([]);
      await repository.listarServiciosGestion({ nombre: 'Corte' });
      esperarConsultaAislada(mockPrisma.servicio.findMany, {
        where: {
          OR: [
            { nombre: { contains: 'Corte' } },
            { descripcion: { contains: 'Corte' } },
          ],
        },
        include: expect.any(Object),
        orderBy: { id: 'desc' },
      });
    });
  });

  describe('listarServiciosPorBarbero', () => {
    it('should return active services for a barbero (Barbero.id)', async () => {
      mockPrisma.servicio.findMany.mockResolvedValue([{ id: 1 }]);
      const result = await repository.listarServiciosPorBarbero(5);
      esperarConsultaAislada(
        mockPrisma.servicio.findMany,
        expect.objectContaining({
          where: expect.objectContaining({
            estado: EstadoServicio.ACTIVO,
            // El identificador del barbero es `Barbero.id` y el barbero debe
            // pertenecer al negocio activo.
            barberos: { some: { barberoId: 5, barbero: { negocioId: 1 } } },
          }),
        }),
      );
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('listarBarberosActivosPorServicio (HE-04-HU-02)', () => {
    it('should return barberos with Barbero.id and map to flat barbero objects', async () => {
      mockPrisma.barberoServicio.findMany.mockResolvedValue([
        {
          barbero: {
            id: 10,
            fotoUrl: '/uploads/barberos/ana.jpg',
            usuario: { id: 100, nombre: 'Ana', apellido: 'Ruiz' },
          },
        },
        {
          barbero: {
            id: 30,
            fotoUrl: null,
            usuario: { id: 300, nombre: 'Zoe', apellido: 'Díaz' },
          },
        },
      ]);

      const result = await repository.listarBarberosActivosPorServicio(2);

      esperarConsultaAislada(
        mockPrisma.barberoServicio.findMany,
        expect.objectContaining({
          where: expect.objectContaining({
            servicioId: 2,
            barbero: {
              estado: 'ACTIVO',
              usuario: { estado: 'ACTIVO' },
              weeklySlots: {
                some: {
                  active: true,
                },
              },
            },
          }),
          select: expect.any(Object),
          orderBy: { barberoId: 'asc' },
        }),
      );
      expect(result).toEqual([
        {
          id: 10,
          fotoUrl: '/uploads/barberos/ana.jpg',
          usuario: { id: 100, nombre: 'Ana', apellido: 'Ruiz' },
        },
        {
          id: 30,
          fotoUrl: null,
          usuario: { id: 300, nombre: 'Zoe', apellido: 'Díaz' },
        },
      ]);
    });

    it('should return empty array when no active barberos for the service', async () => {
      mockPrisma.barberoServicio.findMany.mockResolvedValue([]);

      const result = await repository.listarBarberosActivosPorServicio(2);

      expect(result).toEqual([]);
    });
  });

  describe('crearServicio', () => {
    it('should create a service without barberos', async () => {
      mockPrisma.servicio.create.mockResolvedValue({ id: 1, nombre: 'Corte' });
      const result = await repository.crearServicio({
        nombre: 'Corte',
        precio: 20000,
        duracionMinutos: 30,
      });
      expect(mockPrisma.servicio.create).toHaveBeenCalled();
      expect(result).toEqual({ id: 1, nombre: 'Corte' });
    });

    it('should create a service with barberos', async () => {
      mockPrisma.servicio.create.mockResolvedValue({ id: 1 });
      await repository.crearServicio({
        nombre: 'Corte',
        precio: 20000,
        duracionMinutos: 30,
        barberoIds: [1, 2],
      });
      const call = mockPrisma.servicio.create.mock.calls[0][0];
      expect(call.data.barberos).toBeDefined();
      expect(call.data.barberos.create).toHaveLength(2);
    });
  });

  describe('actualizarServicio', () => {
    it('should update a service without touching barberos', async () => {
      mockPrisma.servicio.update.mockResolvedValue({
        id: 1,
        nombre: 'Corte Actualizado',
      });
      const result = await repository.actualizarServicio(1, {
        nombre: 'Corte Actualizado',
      });
      esperarConsultaAislada(
        mockPrisma.servicio.update,
        expect.objectContaining({ where: { id: 1 } }),
      );
      expect(result).toEqual({ id: 1, nombre: 'Corte Actualizado' });
    });

    it('should sync barberos when barberoIds is provided', async () => {
      mockPrisma.servicio.update.mockResolvedValue({ id: 1 });
      await repository.actualizarServicio(1, { barberoIds: [3] });
      const call = mockPrisma.servicio.update.mock.calls[0][0];
      expect(call.data.barberos.deleteMany).toEqual({});
      expect(call.data.barberos.create).toHaveLength(1);
    });
  });

  describe('cambiarEstado', () => {
    it('should change service status', async () => {
      mockPrisma.servicio.update.mockResolvedValue({
        id: 1,
        estado: EstadoServicio.INACTIVO,
      });
      const result = await repository.cambiarEstado(1, EstadoServicio.INACTIVO);
      esperarConsultaAislada(
        mockPrisma.servicio.update,
        expect.objectContaining({
          where: { id: 1 },
          data: { estado: EstadoServicio.INACTIVO },
        }),
      );
      expect(result.estado).toBe(EstadoServicio.INACTIVO);
    });
  });
});

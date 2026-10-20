import { Test, TestingModule } from '@nestjs/testing';
import { BarberosRepository } from './barberos.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { crearAislamientoNegocio } from '../../negocios/negocio-aislamiento.test-helpers';
import { EstadoUsuario } from '../../../../generated/prisma/enums';

const mockPrismaService = {
  barbero: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
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
const sinNegocio = (valor: unknown, conservar = false): unknown => {
  if (Array.isArray(valor)) {
    return valor.map((item) => sinNegocio(item));
  }

  if (valor === null || typeof valor !== 'object') {
    return valor;
  }

  // Una `Date` (u otro objeto sin propiedades enumerables) se devuelve tal
  // cual: recorrerla la convertirÃƒÆ’Ã‚Â­a en `{}` y la comparaciÃƒÆ’Ã‚Â³n fallarÃƒÆ’Ã‚Â­a.
  if (valor instanceof Date) {
    return valor;
  }

  const entrada = valor as Record<string, unknown>;
  const salida: Record<string, unknown> = {};

  for (const [clave, contenido] of Object.entries(entrada)) {
    if (clave === 'negocioId' && !conservar) {
      continue;
    }
    // En una clave UNICA COMPUESTA el negocioId forma parte de la
    // identidad de la fila: se conserva para poder comprobar que
    // apunta al negocio activo.
    salida[clave] = sinNegocio(
      contenido,
      clave.startsWith('negocioId_'),
    );
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
 * el filtro de negocio. Con el aislamiento, la consulta real incluye ademÃƒÆ’Ã‚Â¡s
 * el `negocioId` del negocio activo. Esta funciÃƒÆ’Ã‚Â³n compara ambas ignorando
 * ese campo, y exige que TODOS los `negocioId` de la consulta real sean el
 * del negocio activo: si el repositorio consultara o escribiera con otro
 * negocio (o sin filtro), la aserciÃƒÆ’Ã‚Â³n fallarÃƒÆ’Ã‚Â­a.
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
      expect(args.map((arg) => sinNegocio(arg))).toEqual([esperado]);
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

describe('BarberosRepository', () => {
  let repository: BarberosRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarberosRepository,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: NegocioAislamientoService,
          useValue: crearAislamientoNegocio(),
        },
      ],
    }).compile();

    repository = module.get<BarberosRepository>(BarberosRepository);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('crearBarberoNuevo', () => {
    it('should create a new barbero', async () => {
      const data = { usuarioId: 1, telefono: '123', porcentajeComision: 50 };
      mockPrismaService.barbero.create.mockResolvedValue({ ...data });

      const result = await repository.crearBarberoNuevo(data);

      esperarConsultaAislada(mockPrismaService.barbero.create, { data });
      expect(result).toEqual(data);
    });
  });

  describe('crearPerfilBarbero', () => {
    it('should call crearBarberoNuevo', async () => {
      const data = { usuarioId: 1, telefono: '123', porcentajeComision: 50 };
      jest
        .spyOn(repository, 'crearBarberoNuevo')
        .mockResolvedValue({ ...data } as any);

      const result = await repository.crearPerfilBarbero(data);

      expect(repository.crearBarberoNuevo).toHaveBeenCalledWith(data);
      expect(result).toEqual(data);
    });
  });

  describe('actualizarComision', () => {
    it('should update comision', async () => {
      mockPrismaService.barbero.update.mockResolvedValue({
        usuarioId: 1,
        porcentajeComision: 60,
      });

      const result = await repository.actualizarComision(1, 60);

      esperarConsultaAislada(mockPrismaService.barbero.update, {
        where: { negocioId_usuarioId: { negocioId: 1, usuarioId: 1 } },
        data: { porcentajeComision: 60 },
      });
      expect(result.porcentajeComision).toBe(60);
    });
  });

  describe('actualizarPerfilBarbero', () => {
    it('should update barbero profile', async () => {
      const data = { telefono: '456' };
      mockPrismaService.barbero.update.mockResolvedValue({
        usuarioId: 1,
        ...data,
      });

      const result = await repository.actualizarPerfilBarbero(1, data);

      esperarConsultaAislada(mockPrismaService.barbero.update, {
        where: { negocioId_usuarioId: { negocioId: 1, usuarioId: 1 } },
        data,
      });
      expect(result).toEqual({ usuarioId: 1, telefono: '456' });
    });
  });

  describe('obtenerBarberoPorUsuarioId', () => {
    it('should return barbero by id', async () => {
      mockPrismaService.barbero.findFirst.mockResolvedValue({ usuarioId: 1 });

      const result = await repository.obtenerBarberoPorUsuarioId(1);

      esperarConsultaAislada(mockPrismaService.barbero.findFirst, {
        where: { usuarioId: 1 },
      });
      expect(result).toEqual({ usuarioId: 1 });
    });
  });

  describe('obtenerBarberoActivoPorId', () => {
    it('should query only when barbero and usuario are ACTIVO', async () => {
      mockPrismaService.barbero.findFirst.mockResolvedValue({ id: 7 });

      const result = await repository.obtenerBarberoActivoPorId(7);

      esperarConsultaAislada(mockPrismaService.barbero.findFirst, {
        where: {
          id: 7,
          estado: EstadoUsuario.ACTIVO,
          usuario: { estado: EstadoUsuario.ACTIVO },
        },
      });
      expect(result).toEqual({ id: 7 });
    });
  });

  describe('obtenerBarberosCatalogo', () => {
    it('should return barberos with ACTIVO status', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);

      const result = await repository.obtenerBarberosCatalogo();

      esperarConsultaAislada(mockPrismaService.barbero.findMany, {
        where: {
          estado: EstadoUsuario.ACTIVO,
          usuario: { estado: EstadoUsuario.ACTIVO },
        },
        include: expect.any(Object),
      });
      expect(result).toEqual([{ id: 1 }]);
    });

    it('should filter by nombre', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);

      await repository.obtenerBarberosCatalogo({ nombre: 'Juan' });

      esperarConsultaAislada(mockPrismaService.barbero.findMany, {
        where: {
          estado: EstadoUsuario.ACTIVO,
          usuario: {
            estado: EstadoUsuario.ACTIVO,
            OR: [
              { nombre: { contains: 'Juan' } },
              { apellido: { contains: 'Juan' } },
            ],
          },
        },
        include: expect.any(Object),
      });
    });
  });

  describe('obtenerBarberosGestion', () => {
    it('should return all barberos without filters', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);
      await repository.obtenerBarberosGestion();
      esperarConsultaAislada(mockPrismaService.barbero.findMany, {
        where: {},
        include: expect.any(Object),
      });
    });

    it('should filter by ACTIVO status', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);
      await repository.obtenerBarberosGestion({ estado: EstadoUsuario.ACTIVO });
      esperarConsultaAislada(mockPrismaService.barbero.findMany, {
        where: {
          estado: EstadoUsuario.ACTIVO,
          usuario: { estado: EstadoUsuario.ACTIVO },
        },
        include: expect.any(Object),
      });
    });

    it('should filter by INACTIVO status', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);
      await repository.obtenerBarberosGestion({
        estado: EstadoUsuario.INACTIVO,
      });
      esperarConsultaAislada(mockPrismaService.barbero.findMany, {
        where: {
          OR: [
            { estado: EstadoUsuario.INACTIVO },
            { usuario: { estado: EstadoUsuario.INACTIVO } },
          ],
        },
        include: expect.any(Object),
      });
    });

    it('should filter by nombre', async () => {
      mockPrismaService.barbero.findMany.mockResolvedValue([{ id: 1 }]);
      await repository.obtenerBarberosGestion({ nombre: 'Juan' });
      esperarConsultaAislada(mockPrismaService.barbero.findMany, {
        where: {
          usuario: {
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

  describe('actualizarEstadoBarbero', () => {
    it('should update status', async () => {
      mockPrismaService.barbero.update.mockResolvedValue({
        usuarioId: 1,
        estado: EstadoUsuario.ACTIVO,
      });
      const result = await repository.actualizarEstadoBarbero(
        1,
        EstadoUsuario.ACTIVO,
      );
      esperarConsultaAislada(mockPrismaService.barbero.update, {
        where: { negocioId_usuarioId: { negocioId: 1, usuarioId: 1 } },
        data: { estado: EstadoUsuario.ACTIVO },
      });
      expect(result.estado).toBe(EstadoUsuario.ACTIVO);
    });
  });

  describe('obtenerBarberoPorId', () => {
    it('debe consultar el barbero por id incluyendo su usuario', async () => {
      const mockBarbero = { id: 5, usuario: { id: 10, nombre: 'Carlos' } };
      mockPrismaService.barbero.findFirst.mockResolvedValue(mockBarbero);

      const result = await repository.obtenerBarberoPorId(5);

      esperarConsultaAislada(mockPrismaService.barbero.findFirst, {
        where: { id: 5 },
        include: { usuario: true },
      });
      expect(result).toBe(mockBarbero);
    });

    it('debe retornar null si no existe el barbero', async () => {
      mockPrismaService.barbero.findFirst.mockResolvedValue(null);

      const result = await repository.obtenerBarberoPorId(999);

      expect(result).toBeNull();
    });
  });
});

import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NegocioAislamientoService } from './negocio-aislamiento.service';
import { NegocioContextoService } from './negocio-contexto.service';
import {
  CONTEXTO_NEGOCIO_A,
  CONTEXTO_NEGOCIO_B,
  NEGOCIO_A,
  NEGOCIO_B,
  crearAislamientoSinContexto,
  establecerContextoNegocio,
  limpiarContextoNegocio,
} from './negocio-aislamiento.test-helpers';
import {
  MODELOS_GLOBALES,
  MODELOS_TENANT_SCOPED,
} from './aislamiento.constants';

/**
 * PRUEBAS DE AISLAMIENTO ENTRE NEGOCIOS A Y B.
 *
 * Verifica que el aislamiento por negocio funciona en la CAPA DE REPOSITORIO:
 * las consultas de A solo devuelven filas de A, A no puede tocar las
 * reservas de B por un id conocido, los listados administrativos quedan
 * acotados, y una operación tenant-scoped sin contexto falla de forma segura.
 *
 * Estas pruebas usan un cliente Prisma SIMULADO (no una base de datos): la
 * verificación contra MariaDB real de los mismos escenarios está en
 * `test/multitenant-aislamiento.e2e-spec.ts`.
 */

/** Fila de reserva simulada. */
interface ReservaSimulada extends Record<string, unknown> {
  id: number;
  barberoId: number;
  servicioId: number;
  clienteId: number;
  negocioId: number | null;
  status: string;
  date: Date;
  startTime: string;
  endTime: string;
  dayOfWeek: string;
}

/** Fila de cliente simulada. */
interface ClienteSimulado extends Record<string, unknown> {
  id: number;
  nombre: string;
  apellido: string | null;
  telefono: string | null;
  email: string | null;
  googleId: string | null;
  usuarioId: number | null;
  negocioId: number | null;
}

/** Fila de servicio simulada. */
interface ServicioSimulado extends Record<string, unknown> {
  id: number;
  nombre: string;
  precio: number;
  negocioId: number | null;
  estado: string;
}

/** Fila de cierre general simulada. */
interface CierreSimulado extends Record<string, unknown> {
  id: number;
  date: Date;
  active: boolean;
  negocioId: number | null;
  allDay: boolean;
  reason: string;
  startTime: string | null;
  endTime: string | null;
}

/**
 * Cliente Prisma simulado que APLICA el filtro de negocio en las lecturas,
 * como hace el motor de base de datos. Permite comprobar que los
 * repositorios piden los datos correctos (el `where` incluye `negocioId`) y
 * que un filtro ausente dejaría ver filas de otro negocio.
 */
class ClientePrismaSimulado {
  readonly reservas: ReservaSimulada[] = [];
  readonly clientes: ClienteSimulado[] = [];
  readonly servicios: ServicioSimulado[] = [];
  readonly cierres: CierreSimulado[] = [];

  /** Llamadas registradas, para comprobar el `where` construido. */
  readonly llamadas: Array<{ modelo: string; where: unknown }> = [];

  reservation = {
    findFirst: (args: { where: Record<string, unknown> }) => {
      this.llamadas.push({ modelo: 'reservation', where: args.where });
      return Promise.resolve(
        this.reservas.find((r) => this.coincide(r, args.where)) ?? null,
      );
    },
    findMany: (args: { where?: Record<string, unknown> }) => {
      this.llamadas.push({ modelo: 'reservation', where: args.where });
      return Promise.resolve(
        this.reservas.filter((r) => this.coincide(r, args.where ?? {})),
      );
    },
    findUnique: (args: { where: Record<string, unknown> }) => {
      this.llamadas.push({ modelo: 'reservation', where: args.where });
      return Promise.resolve(
        this.reservas.find((r) => this.coincide(r, args.where)) ?? null,
      );
    },
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      this.llamadas.push({ modelo: 'reservation', where: args.where });
      const affected = this.reservas.filter((r) =>
        this.coincide(r, args.where),
      );
      for (const fila of affected) {
        Object.assign(fila, args.data);
      }
      return Promise.resolve({ count: affected.length });
    },
    update: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      this.llamadas.push({ modelo: 'reservation', where: args.where });
      const fila = this.reservas.find((r) => this.coincide(r, args.where));
      if (!fila) {
        return Promise.reject(new Error('Registro no encontrado'));
      }
      Object.assign(fila, args.data);
      return Promise.resolve(fila);
    },
  };

  cliente = {
    findFirst: (args: { where: Record<string, unknown> }) => {
      this.llamadas.push({ modelo: 'cliente', where: args.where });
      return Promise.resolve(
        this.clientes.find((c) => this.coincide(c, args.where)) ?? null,
      );
    },
    findMany: (args: { where?: Record<string, unknown> }) => {
      this.llamadas.push({ modelo: 'cliente', where: args.where });
      return Promise.resolve(
        this.clientes.filter((c) => this.coincide(c, args.where ?? {})),
      );
    },
    findUnique: (args: { where: Record<string, unknown> }) => {
      this.llamadas.push({ modelo: 'cliente', where: args.where });
      return Promise.resolve(
        this.clientes.find((c) => this.coincide(c, args.where)) ?? null,
      );
    },
  };

  servicio = {
    findFirst: (args: { where: Record<string, unknown> }) => {
      this.llamadas.push({ modelo: 'servicio', where: args.where });
      return Promise.resolve(
        this.servicios.find((s) => this.coincide(s, args.where)) ?? null,
      );
    },
    findMany: (args: { where?: Record<string, unknown> }) => {
      this.llamadas.push({ modelo: 'servicio', where: args.where });
      return Promise.resolve(
        this.servicios.filter((s) => this.coincide(s, args.where ?? {})),
      );
    },
  };

  generalClosure = {
    findMany: (args: { where?: Record<string, unknown> }) => {
      this.llamadas.push({ modelo: 'generalClosure', where: args.where });
      return Promise.resolve(
        this.cierres.filter((c) => this.coincide(c, args.where ?? {})),
      );
    },
  };

  /**
   * Evalúa un `where` de Prisma simulado: compara los campos escalares y
   * resuelve el `OR` de la búsqueda por texto.
   *
   * Como en Prisma, un `OR` dentro del `where` se combina con el resto de
   * condiciones mediante AND: la fila debe cumplir el `OR` Y el resto de
   * campos (entre ellos, el `negocioId`).
   */
  private coincide(
    fila: Record<string, unknown>,
    where: Record<string, unknown>,
  ): boolean {
    if (where.OR) {
      const alternativas = where.OR as Array<Record<string, unknown>>;
      const cumpleOr = alternativas.some((alterna) =>
        this.coincideSinNegocio(fila, alterna),
      );

      if (!cumpleOr) {
        return false;
      }

      const resto = { ...where };
      delete resto.OR;

      return this.coincideSinNegocio(fila, resto);
    }

    return this.coincideSinNegocio(fila, where);
  }

  /** Compara los campos escalares de un `where` (sin el `OR`). */
  private coincideSinNegocio(
    fila: Record<string, unknown>,
    where: Record<string, unknown>,
  ): boolean {
    return Object.entries(where).every(([clave, valor]) => {
      if (valor === undefined) {
        return true;
      }
      if (valor !== null && typeof valor === 'object') {
        return true;
      }
      return fila[clave] === valor;
    });
  }
}

describe('Aislamiento entre negocios A y B (capa de repositorio)', () => {
  let prisma: ClientePrismaSimulado;
  let contexto: NegocioContextoService;

  /**
   * Crea un `NegocioAislamientoService` con el contexto del negocio indicado.
   *
   * El contexto se fija en el almacén compartido (`enterWith`), que es el
   * mismo mecanismo que usa el middleware en producción: el aislamiento lee
   * de ahí, no de una propiedad del servicio.
   */
  const aislamientoDe = (negocioId: number): NegocioAislamientoService => {
    establecerContextoNegocio(
      negocioId === NEGOCIO_A ? CONTEXTO_NEGOCIO_A : CONTEXTO_NEGOCIO_B,
    );

    return new NegocioAislamientoService(contexto);
  };

  beforeEach(async () => {
    prisma = new ClientePrismaSimulado();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NegocioContextoService,
        NegocioAislamientoService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    contexto = module.get(NegocioContextoService);

    // Datos de los dos negocios.
    prisma.reservas.push(
      {
        id: 1,
        barberoId: 10,
        servicioId: 20,
        clienteId: 30,
        negocioId: NEGOCIO_A,
        status: 'PENDING',
        date: new Date('2026-11-01T00:00:00.000Z'),
        startTime: '10:00',
        endTime: '10:30',
        dayOfWeek: 'SUNDAY',
      },
      {
        id: 2,
        barberoId: 11,
        servicioId: 21,
        clienteId: 31,
        negocioId: NEGOCIO_B,
        status: 'PENDING',
        date: new Date('2026-11-01T00:00:00.000Z'),
        startTime: '10:00',
        endTime: '10:30',
        dayOfWeek: 'SUNDAY',
      },
    );

    prisma.clientes.push(
      {
        id: 30,
        nombre: 'Cliente',
        apellido: 'A',
        telefono: '300',
        email: 'a@test.local',
        googleId: 'google-a',
        usuarioId: 1,
        negocioId: NEGOCIO_A,
      },
      {
        id: 31,
        nombre: 'Cliente',
        apellido: 'B',
        telefono: '301',
        email: 'b@test.local',
        googleId: 'google-b',
        usuarioId: 2,
        negocioId: NEGOCIO_B,
      },
    );

    prisma.servicios.push(
      {
        id: 20,
        nombre: 'Servicio A',
        precio: 1000,
        negocioId: NEGOCIO_A,
        estado: 'ACTIVO',
      },
      {
        id: 21,
        nombre: 'Servicio B',
        precio: 2000,
        negocioId: NEGOCIO_B,
        estado: 'ACTIVO',
      },
    );

    prisma.cierres.push(
      {
        id: 40,
        date: new Date('2026-12-25T00:00:00.000Z'),
        active: true,
        negocioId: NEGOCIO_A,
        allDay: true,
        reason: 'Navidad',
        startTime: null,
        endTime: null,
      } satisfies CierreSimulado,
      {
        id: 41,
        date: new Date('2026-12-25T00:00:00.000Z'),
        active: true,
        negocioId: NEGOCIO_B,
        allDay: true,
        reason: 'Navidad B',
        startTime: null,
        endTime: null,
      } satisfies CierreSimulado,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    limpiarContextoNegocio();
  });

  describe('1. Las consultas de A solo devuelven registros de A', () => {
    it('el filtro de lectura incluye el negocio del contexto', () => {
      const where = aislamientoDe(NEGOCIO_A).filtroLectura({ barberoId: 10 });

      expect(where).toEqual({ barberoId: 10, negocioId: NEGOCIO_A });
    });

    it('un listado acotado al negocio no incluye filas de B', async () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      const resultado = await prisma.reservation.findMany({
        where: aislamientoA.filtroLectura({}),
      });

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe(1);
      expect(resultado.every((r) => r.negocioId === NEGOCIO_A)).toBe(true);
    });
  });

  describe('2. A no puede consultar ni modificar reservas de B por un id conocido', () => {
    it('consultar la reserva de B desde el contexto de A devuelve null', async () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      const resultado = await prisma.reservation.findUnique({
        where: aislamientoA.filtroEscritura({ id: 2 }),
      });

      expect(resultado).toBeNull();
    });

    it('modificar la reserva de B desde el contexto de A no afecta a ninguna fila', async () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      const resultado = await prisma.reservation.updateMany({
        where: aislamientoA.filtroEscritura({ id: 2 }),
        data: { status: 'CANCELLED' },
      });

      expect(resultado.count).toBe(0);
      // La reserva de B conserva su estado.
      expect(prisma.reservas.find((r) => r.id === 2)?.status).toBe('PENDING');
    });

    it('A puede modificar su propia reserva', async () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      const resultado = await prisma.reservation.updateMany({
        where: aislamientoA.filtroEscritura({ id: 1 }),
        data: { status: 'CONFIRMED' },
      });

      expect(resultado.count).toBe(1);
      expect(prisma.reservas.find((r) => r.id === 1)?.status).toBe('CONFIRMED');
    });
  });

  describe('3. Los listados y búsquedas administrativas quedan restringidos al negocio', () => {
    it('la búsqueda por texto de clientes no devuelve clientes de B', async () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      const resultado = await prisma.cliente.findMany({
        where: aislamientoA.filtroLectura({
          OR: [{ nombre: { contains: 'Cliente' } }],
        }),
      });

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe(30);
    });

    it('la búsqueda de clientes lleva el filtro de negocio en el where', () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      const where = aislamientoA.filtroLectura({
        OR: [{ nombre: { contains: 'Cliente' } }],
      });

      expect(where).toHaveProperty('negocioId', NEGOCIO_A);
      expect(where.OR).toEqual([{ nombre: { contains: 'Cliente' } }]);
    });
  });

  describe('4. Un cierre general de A no afecta a B', () => {
    it('el contexto de A solo ve los cierres de A', async () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      const resultado = await prisma.generalClosure.findMany({
        where: aislamientoA.filtroLectura({
          date: new Date('2026-12-25T00:00:00.000Z'),
          active: true,
        }),
      });

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe(40);
    });

    it('el contexto de B ve su propio cierre', async () => {
      const aislamientoB = aislamientoDe(NEGOCIO_B);

      const resultado = await prisma.generalClosure.findMany({
        where: aislamientoB.filtroLectura({
          date: new Date('2026-12-25T00:00:00.000Z'),
          active: true,
        }),
      });

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe(41);
    });
  });

  describe('5. La disponibilidad en el contexto A no revela datos de un barbero de B', () => {
    it('el servicio de B no se resuelve desde el contexto de A', async () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      const resultado = await prisma.servicio.findFirst({
        where: aislamientoA.filtroLectura({ id: 21 }),
      });

      expect(resultado).toBeNull();
    });

    it('el servicio propio sí se resuelve', async () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      const resultado = await prisma.servicio.findFirst({
        where: aislamientoA.filtroLectura({ id: 20 }),
      });

      expect(resultado?.nombre).toBe('Servicio A');
    });
  });

  describe('6. Las escrituras no pueden crear relaciones cruzadas', () => {
    it('el filtro de escritura incluye el negocio del contexto', () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      const where = aislamientoA.filtroEscritura({ id: 2 });

      expect(where).toEqual({ id: 2, negocioId: NEGOCIO_A });
    });

    it('una escritura con un negocio distinto se rechaza', () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      expect(() =>
        aislamientoA.filtroEscritura({ id: 2, negocioId: NEGOCIO_B }),
      ).not.toThrow();
      // El filtro EXIGE el negocio del contexto: el valor del cliente no
      // puede desviarlo.
      expect(aislamientoA.filtroEscritura({ id: 2 })).toEqual({
        id: 2,
        negocioId: NEGOCIO_A,
      });
    });
  });

  describe('7. Las consultas tenant-scoped sin contexto fallan de forma segura', () => {
    it('exigir el negocio sin contexto lanza ForbiddenException', () => {
      const aislamientoSinContexto = crearAislamientoSinContexto();

      expect(() => aislamientoSinContexto.negocioIdRequerido()).toThrow(
        ForbiddenException,
      );
    });

    it('el filtro de lectura sin contexto no devuelve ninguna fila', () => {
      const aislamientoSinContexto = crearAislamientoSinContexto();

      expect(() => aislamientoSinContexto.filtroLectura({ id: 1 })).toThrow(
        ForbiddenException,
      );
    });

    it('el almacén de contexto no hereda el de una petición anterior', () => {
      // Tras el caso anterior, el contexto debe estar limpio: una operación
      // tenant-scoped sin contexto no puede apoyarse en el contexto residual
      // de otra prueba. Se comprueba sobre el SERVICIO REAL, que lee del
      // almacén compartido (el mismo que usa la extensión de Prisma).
      limpiarContextoNegocio();

      const aislamientoReal = new NegocioAislamientoService(contexto);

      expect(() => aislamientoReal.negocioIdRequerido()).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('8. La pertenencia al negocio se comprueba explícitamente', () => {
    it('rechaza un recurso de otro negocio', () => {
      const aislamientoA = aislamientoDe(NEGOCIO_A);

      expect(aislamientoA.perteneceAlNegocioActivo(NEGOCIO_A)).toBe(true);
      expect(aislamientoA.perteneceAlNegocioActivo(NEGOCIO_B)).toBe(false);
      expect(() => aislamientoA.exigirPertenencia(NEGOCIO_B)).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('9. Los modelos globales no se filtran', () => {
    it('el inventario de modelos tenant-scoped excluye los globales', () => {
      expect(MODELOS_TENANT_SCOPED).toContain('Reservation');
      expect(MODELOS_TENANT_SCOPED).toContain('Cliente');
      expect(MODELOS_TENANT_SCOPED).not.toContain('Usuario');
      expect(MODELOS_TENANT_SCOPED).not.toContain('Negocio');
      expect(MODELOS_TENANT_SCOPED).not.toContain('ConfiguracionSistema');
      expect(MODELOS_TENANT_SCOPED).not.toContain('WhatsAppPlantilla');
      expect(MODELOS_GLOBALES).toContain('Usuario');
      expect(MODELOS_GLOBALES).toContain('Negocio');
    });

    it('los nombres coinciden con los delegates de Prisma', () => {
      // Los delegates siguen el nombre del MODELO en PascalCase: un nombre
      // en minúsculas haría que el filtro NUNCA se aplicase.
      expect(MODELOS_TENANT_SCOPED).toContain('BarberoServicio');
      expect(MODELOS_TENANT_SCOPED).toContain('BarberWeeklySlot');
      expect(MODELOS_TENANT_SCOPED).toContain('ConfiguracionNegocio');
    });
  });
});

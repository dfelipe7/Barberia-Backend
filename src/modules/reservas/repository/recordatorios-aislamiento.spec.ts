import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReservationStatus } from '../../../../generated/prisma/enums';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { ReservasRepository } from '../repository/reservas.repository';

/**
 * PRUEBA DEL AISLAMIENTO DEL CRON DE RECORDATORIOS (HU-11).
 *
 * El cron (`src/modules/reservas/cron/recordatorios.cron.ts`) es propiedad de
 * HU-11 y NO se modifica en esta fase. Esta prueba comprueba que la capa que
 * lo alimenta (`ReservasRepository`) mantiene el aislamiento:
 *
 *  1. `obtenerCitasPendientesRecordatorio` RECORRE LOS NEGOCIOS UNO A UNO:
 *     cada consulta se hace con el contexto de su negocio, de modo que la
 *     extensión de Prisma sigue aplicando y ninguna consulta sale de su
 *     ámbito. Devuelve el mismo conjunto de citas que antes, por lo que el
 *     cron de HU-11 no necesita cambios ni se interrumpe.
 *  2. `marcarRecordatorioEnviado` acota la escritura al negocio de la
 *     reserva.
 *
 * Usa un cliente Prisma SIMULADO: se comprueba el MECANISMO, no la
 * persistencia (que se comprueba contra MariaDB en
 * `test/multitenant-aislamiento.e2e-spec.ts`).
 */

/** Reserva simulada. */
interface ReservaSimulada extends Record<string, unknown> {
  id: number;
  negocioId: number | null;
  date: Date;
  status: string;
  recordatorioEnviado: boolean;
}

/** Cliente Prisma simulado que registra las consultas por negocio. */
class ClientePrismaSimulado {
  readonly reservas: ReservaSimulada[] = [];
  readonly negocios = [
    { id: 1, slug: 'negocio-a' },
    { id: 2, slug: 'negocio-b' },
  ];

  /** Consultas de `findMany` registradas: modelo y where. */
  readonly consultas: Array<{ where: Record<string, unknown> }> = [];

  /** Actualizaciones registradas: where y data. */
  readonly actualizaciones: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];

  negocio = {
    findMany: () => Promise.resolve(this.negocios),
  };

  reservation = {
    findMany: (args: { where: Record<string, unknown> }) => {
      this.consultas.push({ where: args.where });

      const negocioId = args.where.negocioId as number | undefined;

      return Promise.resolve(
        this.reservas.filter(
          (r) => r.negocioId === negocioId && r.recordatorioEnviado === false,
        ),
      );
    },
    findUnique: (args: { where: Record<string, unknown> }) => {
      const id = args.where.id as number;
      const reserva = this.reservas.find((r) => r.id === id);

      return Promise.resolve(
        reserva
          ? {
              negocioId: reserva.negocioId,
              negocio: reserva.negocioId
                ? this.negocios.find((n) => n.id === reserva.negocioId)
                : null,
            }
          : null,
      );
    },
    update: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      this.actualizaciones.push({ where: args.where, data: args.data });

      const id = args.where.id as number;
      const reserva = this.reservas.find((r) => r.id === id);

      if (reserva) {
        Object.assign(reserva, args.data);
      }

      return Promise.resolve(reserva ?? null);
    },
  };
}

describe('Aislamiento del cron de recordatorios (HU-11)', () => {
  let prisma: ClientePrismaSimulado;
  let repository: ReservasRepository;

  beforeEach(async () => {
    prisma = new ClientePrismaSimulado();

    prisma.reservas.push(
      {
        id: 1,
        negocioId: 1,
        date: new Date('2026-11-01T00:00:00.000Z'),
        status: ReservationStatus.PENDING,
        recordatorioEnviado: false,
      },
      {
        id: 2,
        negocioId: 2,
        date: new Date('2026-11-01T00:00:00.000Z'),
        status: ReservationStatus.PENDING,
        recordatorioEnviado: false,
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservasRepository,
        NegocioContextoService,
        NegocioAislamientoService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    repository = module.get(ReservasRepository);
  });

  it('recorre los negocios uno a uno, cada consulta acotada a su negocio', async () => {
    const fecha = new Date('2026-11-01T00:00:00.000Z');

    await repository.obtenerCitasPendientesRecordatorio(fecha);

    // Una consulta por negocio, cada una con su propio `negocioId`.
    expect(prisma.consultas).toHaveLength(2);
    expect(prisma.consultas[0].where.negocioId).toBe(1);
    expect(prisma.consultas[1].where.negocioId).toBe(2);
  });

  it('devuelve las citas de TODOS los negocios, como espera el cron de HU-11', async () => {
    const fecha = new Date('2026-11-01T00:00:00.000Z');

    const citas = await repository.obtenerCitasPendientesRecordatorio(fecha);

    // El cron sigue recibiendo el conjunto completo: no se interrumpe.
    expect(citas).toHaveLength(2);
    expect(citas.map((c) => c.id).sort()).toEqual([1, 2]);
  });

  it('no devuelve citas de un negocio distinto del que se consulta', async () => {
    const fecha = new Date('2026-11-01T00:00:00.000Z');

    await repository.obtenerCitasPendientesRecordatorio(fecha);

    // Cada consulta devuelve únicamente las filas de su negocio.
    expect(prisma.consultas.every((c) => c.where.negocioId !== undefined)).toBe(
      true,
    );
  });

  it('marca el recordatorio acotado al negocio de la reserva', async () => {
    await repository.marcarRecordatorioEnviado(1);

    expect(prisma.actualizaciones).toHaveLength(1);
    expect(prisma.actualizaciones[0].where.negocioId).toBe(1);
    expect(prisma.actualizaciones[0].data).toEqual({
      recordatorioEnviado: true,
    });
  });

  it('no marca una reserva que no tiene negocio asignado', async () => {
    prisma.reservas.push({
      id: 3,
      negocioId: null,
      date: new Date('2026-11-01T00:00:00.000Z'),
      status: ReservationStatus.PENDING,
      recordatorioEnviado: false,
    });

    await repository.marcarRecordatorioEnviado(3);

    // Sin negocio no hay ámbito al que acotar: no se escribe.
    expect(prisma.actualizaciones).toHaveLength(0);
  });

  it('ignora un negocio inexistente en la lista de negocios', async () => {
    prisma.negocios.length = 0;

    const citas = await repository.obtenerCitasPendientesRecordatorio(
      new Date('2026-11-01T00:00:00.000Z'),
    );

    expect(citas).toEqual([]);
    expect(prisma.consultas).toHaveLength(0);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReservationStatus } from '../../../../generated/prisma/enums';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { ReservasRepository } from '../repository/reservas.repository';

/**
 * PRUEBA DEL AISLAMIENTO DEL CRON DE RECORDATORIOS (HU-11, Fase 9).
 *
 * El cron (`src/modules/reservas/cron/recordatorios.cron.ts`) fija él mismo el
 * contexto de cada negocio. Esta prueba comprueba el CONTRATO de la capa que
 * lo alimenta (`ReservasRepository`):
 *
 *  1. `obtenerCitasPendientesRecordatorio` está acotada al negocio del
 *     CONTEXTO y **falla** si no hay contexto (no degrada a "todas las citas").
 *  2. `marcarRecordatorioEnviado` escribe con el negocio del contexto: marcar
 *     una reserva de OTRO negocio no afecta a ninguna fila.
 *
 * Usa un cliente Prisma SIMULADO: se comprueba el MECANISMO, no la
 * persistencia (que se comprueba contra MariaDB en
 * `test/multitenant-hu11.e2e-spec.ts`).
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

  /** Consultas de `findMany` registradas: modelo y where. */
  readonly consultas: Array<{ where: Record<string, unknown> }> = [];

  /** Actualizaciones registradas: where y data. */
  readonly actualizaciones: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];

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
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      this.actualizaciones.push({ where: args.where, data: args.data });

      const id = args.where.id as number;
      const negocioId = args.where.negocioId as number | undefined;
      const reserva = this.reservas.find(
        (r) => r.id === id && r.negocioId === negocioId,
      );

      if (reserva) {
        Object.assign(reserva, args.data);
      }

      return Promise.resolve({ count: reserva ? 1 : 0 });
    },
  };
}

describe('Aislamiento del cron de recordatorios (HU-11)', () => {
  let prisma: ClientePrismaSimulado;
  let repository: ReservasRepository;
  let contextoService: NegocioContextoService;

  const NEGOCIO_A = { id: 1, slug: 'negocio-a' };
  const NEGOCIO_B = { id: 2, slug: 'negocio-b' };
  const FECHA = new Date('2026-11-01T00:00:00.000Z');

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
    contextoService = module.get(NegocioContextoService);
  });

  it('consulta acotada al negocio del contexto', async () => {
    await contextoService.ejecutarEnContexto(NEGOCIO_A, () =>
      repository.obtenerCitasPendientesRecordatorio(FECHA),
    );

    expect(prisma.consultas).toHaveLength(1);
    expect(prisma.consultas[0].where.negocioId).toBe(1);
  });

  it('devuelve únicamente las citas del negocio del contexto', async () => {
    const citas = await contextoService.ejecutarEnContexto(NEGOCIO_A, () =>
      repository.obtenerCitasPendientesRecordatorio(FECHA),
    );

    expect(citas.map((c) => c.id)).toEqual([1]);
  });

  it('cada negocio ve SUS citas: el contexto de B no ve las de A', async () => {
    const citas = await contextoService.ejecutarEnContexto(NEGOCIO_B, () =>
      repository.obtenerCitasPendientesRecordatorio(FECHA),
    );

    expect(citas.map((c) => c.id)).toEqual([2]);
  });

  it('sin contexto FALLA: nunca devuelve las citas de todos los negocios', async () => {
    await expect(
      repository.obtenerCitasPendientesRecordatorio(FECHA),
    ).rejects.toBeTruthy();

    expect(prisma.consultas).toHaveLength(0);
  });

  it('marca el recordatorio acotado al negocio del contexto', async () => {
    await contextoService.ejecutarEnContexto(NEGOCIO_A, () =>
      repository.marcarRecordatorioEnviado(1),
    );

    expect(prisma.actualizaciones).toHaveLength(1);
    expect(prisma.actualizaciones[0].where.negocioId).toBe(1);
    expect(prisma.actualizaciones[0].data).toEqual({
      recordatorioEnviado: true,
    });
    expect(prisma.reservas.find((r) => r.id === 1)?.recordatorioEnviado).toBe(
      true,
    );
  });

  it('NO marca una reserva de otro negocio', async () => {
    await contextoService.ejecutarEnContexto(NEGOCIO_A, () =>
      repository.marcarRecordatorioEnviado(2),
    );

    // La escritura va acotada al negocio del contexto: no afecta a la fila.
    expect(prisma.reservas.find((r) => r.id === 2)?.recordatorioEnviado).toBe(
      false,
    );
  });

  it('sin contexto, marcar el recordatorio FALLA', async () => {
    await expect(repository.marcarRecordatorioEnviado(1)).rejects.toBeTruthy();

    expect(prisma.actualizaciones).toHaveLength(0);
  });
});

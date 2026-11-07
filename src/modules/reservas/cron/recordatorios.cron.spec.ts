import { Test, TestingModule } from '@nestjs/testing';
import { RecordatoriosCron } from './recordatorios.cron';
import { ReservasRepository } from '../repository/reservas.repository';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { FechaBogotaService } from '../../horarios/common/fecha-bogota.service';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { NegociosRepository } from '../../negocios/repository/negocios.repository';
import { EstadoNegocio } from '../../../../generated/prisma/enums';

// `@nestjs/schedule` se distribuye como ESM y Jest lo ejecuta en CommonJS:
// se sustituye por un doble mínimo (el decorador `@Cron` no aporta nada a la
// lógica que se prueba aquí).
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_10_MINUTES: '*/10 * * * *' },
}));

/** Cita simulada que devuelve el repositorio. */
interface CitaSimulada {
  id: number;
  startTime: string;
  precioReservado: number | null;
  cliente: { nombre: string; apellido: string; telefono: string | null };
  barbero: { usuario: { nombre: string; apellido: string } };
  servicio: { nombre: string; precio: number };
}

/** Datos con los que el cron envía el recordatorio. */
interface DatosEnvio {
  clienteNombre: string;
  hora: string;
}

/**
 * Cron de recordatorios en un mundo MULTI-NEGOCIO.
 *
 * Lo que se comprueba aquí es el CONTRATO de aislamiento del proceso de
 * fondo:
 *   1. Cada negocio se procesa dentro de SU contexto.
 *   2. Un fallo en un negocio NO impide procesar los demás.
 *   3. Solo se procesan los negocios activos.
 *   4. La ventana de anticipación es la del negocio que se procesa.
 *   5. Solo se marcan como enviados los recordatorios realmente enviados.
 */
describe('RecordatoriosCron (multitenant)', () => {
  let cron: RecordatoriosCron;

  const NEGOCIO_A = { id: 1, slug: 'negocio-a', nombre: 'Negocio A' };
  const NEGOCIO_B = { id: 2, slug: 'negocio-b', nombre: 'Negocio B' };
  const NEGOCIO_INACTIVO = {
    id: 3,
    slug: 'negocio-inactivo',
    nombre: 'Negocio Inactivo',
  };

  /** Negocio del contexto simulado en cada momento. */
  let contextoActual: { id: number; slug: string } | undefined;

  /** Citas que el repositorio devuelve, en función del contexto vigente. */
  let citasPorNegocio: Record<number, CitaSimulada[]> = {};

  /** Minutos de anticipación configurados por negocio. */
  let anticipacionPorNegocio: Record<number, number> = {};

  const ejecutarEnContexto = jest.fn(
    (
      contexto: { id: number; slug: string },
      operacion: () => Promise<unknown>,
    ) => {
      contextoActual = contexto;
      return operacion();
    },
  );

  const obtenerCitasPendientesRecordatorio = jest
    .fn<Promise<CitaSimulada[]>, [Date]>()
    .mockImplementation(() => {
      if (!contextoActual) {
        return Promise.reject(
          new Error('Consulta sin contexto de negocio: no debe ocurrir.'),
        );
      }
      return Promise.resolve(citasPorNegocio[contextoActual.id] ?? []);
    });

  const marcarRecordatorioEnviado = jest
    .fn<Promise<void>, [number]>()
    .mockResolvedValue(undefined);

  const enviarRecordatorioReserva = jest
    .fn<Promise<boolean>, [DatosEnvio]>()
    .mockResolvedValue(true);

  const getStatus = jest.fn(() => ({ conectado: true }));
  const hayAlgunaSesionConectada = jest.fn(() => true);

  const obtenerMinutosAnticipacion = jest
    .fn<Promise<number>, []>()
    .mockImplementation(() =>
      Promise.resolve(anticipacionPorNegocio[contextoActual?.id ?? 0] ?? 120),
    );

  const listar = jest.fn(() =>
    Promise.resolve([
      { ...NEGOCIO_A, estado: EstadoNegocio.ACTIVO },
      { ...NEGOCIO_B, estado: EstadoNegocio.ACTIVO },
      { ...NEGOCIO_INACTIVO, estado: EstadoNegocio.INACTIVO },
    ]),
  );

  /** Cita de ejemplo (dentro de la ventana de 120 min a las 09:00). */
  const cita = (id: number, startTime: string) => ({
    id,
    startTime,
    precioReservado: 25000,
    cliente: { nombre: 'Carlos', apellido: 'Pérez', telefono: '3001234567' },
    barbero: { usuario: { nombre: 'Duvan', apellido: 'Reyes' } },
    servicio: { nombre: 'Corte clásico', precio: 25000 },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    getStatus.mockReset();
    getStatus.mockReturnValue({ conectado: true });
    hayAlgunaSesionConectada.mockReset();
    hayAlgunaSesionConectada.mockReturnValue(true);
    contextoActual = undefined;
    anticipacionPorNegocio = {};
    obtenerCitasPendientesRecordatorio.mockImplementation(() => {
      if (!contextoActual) {
        return Promise.reject(
          new Error('Consulta sin contexto de negocio: no debe ocurrir.'),
        );
      }
      return Promise.resolve(citasPorNegocio[contextoActual.id] ?? []);
    });
    citasPorNegocio = {
      [NEGOCIO_A.id]: [cita(101, '09:30'), cita(102, '15:00')],
      [NEGOCIO_B.id]: [cita(201, '10:00')],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordatoriosCron,
        {
          provide: ReservasRepository,
          useValue: {
            obtenerCitasPendientesRecordatorio,
            marcarRecordatorioEnviado,
          },
        },
        {
          provide: WhatsAppService,
          useValue: {
            getStatus,
            hayAlgunaSesionConectada,
            obtenerMinutosAnticipacion,
            enviarRecordatorioReserva,
          },
        },
        {
          provide: FechaBogotaService,
          useValue: {
            obtenerComponentesBogota: () => ({
              fecha: '2026-11-02',
              hora24: 9,
              minuto: 0,
            }),
          },
        },
        { provide: NegocioContextoService, useValue: { ejecutarEnContexto } },
        { provide: NegociosRepository, useValue: { listar } },
      ],
    }).compile();

    cron = module.get<RecordatoriosCron>(RecordatoriosCron);
  });

  it('no consulta nada si WhatsApp no está conectado', async () => {
    getStatus.mockReturnValue({ conectado: false });
    hayAlgunaSesionConectada.mockReturnValue(false);

    await cron.procesarRecordatorios();

    expect(listar).not.toHaveBeenCalled();
    expect(obtenerCitasPendientesRecordatorio).not.toHaveBeenCalled();
  });

  it('procesa cada negocio activo dentro de SU propio contexto', async () => {
    await cron.procesarRecordatorios();

    expect(ejecutarEnContexto).toHaveBeenCalledTimes(2);
    expect(ejecutarEnContexto.mock.calls[0][0]).toMatchObject({
      id: NEGOCIO_A.id,
      slug: NEGOCIO_A.slug,
    });
    expect(ejecutarEnContexto.mock.calls[1][0]).toMatchObject({
      id: NEGOCIO_B.id,
      slug: NEGOCIO_B.slug,
    });
  });

  it('no procesa los negocios inactivos', async () => {
    await cron.procesarRecordatorios();

    const contextos = ejecutarEnContexto.mock.calls.map((c) => c[0]);
    expect(contextos.map((c) => c.id)).not.toContain(NEGOCIO_INACTIVO.id);
  });

  it('el fallo de un negocio NO impide procesar el siguiente', async () => {
    obtenerCitasPendientesRecordatorio.mockImplementationOnce(() =>
      Promise.reject(new Error('Fallo simulado en el negocio A')),
    );

    await expect(cron.procesarRecordatorios()).resolves.toBeUndefined();

    // El negocio B se sigue procesando.
    expect(enviarRecordatorioReserva).toHaveBeenCalledTimes(1);
    expect(enviarRecordatorioReserva.mock.calls[0][0]).toMatchObject({
      clienteNombre: 'Carlos Pérez',
    });
  });

  it('envía el recordatorio solo a las citas dentro de la ventana de anticipación', async () => {
    await cron.procesarRecordatorios();

    // A: 09:30 entra en la ventana de 120 min; 15:00 no.
    // B: 10:00 entra en la ventana.
    expect(enviarRecordatorioReserva).toHaveBeenCalledTimes(2);
    const llamadas = enviarRecordatorioReserva.mock.calls.map((c) => c[0]);
    expect(llamadas.map((c) => c.hora)).toEqual(['09:30', '10:00']);
  });

  it('usa la anticipación configurada por cada negocio', async () => {
    anticipacionPorNegocio[NEGOCIO_A.id] = 15;

    await cron.procesarRecordatorios();

    // Con 15 min de anticipación, la cita de A (09:30) queda fuera y la de B
    // (10:00, dentro de 60 min) sigue dentro.
    expect(obtenerMinutosAnticipacion).toHaveBeenCalled();
    const llamadas = enviarRecordatorioReserva.mock.calls.map((c) => c[0]);
    expect(llamadas.map((c) => c.hora)).toEqual(['10:00']);
  });

  it('envía el recordatorio con los datos de la cita', async () => {
    await cron.procesarRecordatorios();

    expect(enviarRecordatorioReserva).toHaveBeenCalledWith({
      telefono: '3001234567',
      clienteNombre: 'Carlos Pérez',
      servicioNombre: 'Corte clásico',
      barberoNombre: 'Duvan Reyes',
      fecha: '2026-11-02',
      hora: '09:30',
      precio: 25000,
    });
  });

  it('usa servicio.precio si precioReservado es nulo, y null si ninguno tiene precio', async () => {
    citasPorNegocio[NEGOCIO_A.id] = [
      {
        id: 301,
        startTime: '09:30',
        precioReservado: null,
        cliente: { nombre: 'Mario', apellido: 'Ruiz', telefono: '3009998877' },
        barbero: { usuario: { nombre: 'Duvan', apellido: 'Reyes' } },
        servicio: { nombre: 'Barba', precio: 15000 },
      },
      {
        id: 302,
        startTime: '09:35',
        precioReservado: null,
        cliente: { nombre: 'Luigi', apellido: 'Ruiz', telefono: '3009998878' },
        barbero: { usuario: { nombre: 'Duvan', apellido: 'Reyes' } },
        servicio: { nombre: 'Corte' } as any,
      },
    ];
    citasPorNegocio[NEGOCIO_B.id] = [];

    await cron.procesarRecordatorios();

    expect(enviarRecordatorioReserva).toHaveBeenCalledWith(
      expect.objectContaining({ clienteNombre: 'Mario Ruiz', precio: 15000 }),
    );
    expect(enviarRecordatorioReserva).toHaveBeenCalledWith(
      expect.objectContaining({ clienteNombre: 'Luigi Ruiz', precio: null }),
    );
  });

  it('no propaga un error inesperado del estado de la conexión', async () => {
    getStatus.mockImplementation(() => {
      throw new Error('Fallo de conexión');
    });

    await expect(cron.procesarRecordatorios()).resolves.toBeUndefined();
  });

  it('marca como enviado SOLO los recordatorios realmente enviados', async () => {
    await cron.procesarRecordatorios();

    expect(marcarRecordatorioEnviado).toHaveBeenCalledTimes(2);
    expect(marcarRecordatorioEnviado).toHaveBeenCalledWith(101);
    expect(marcarRecordatorioEnviado).toHaveBeenCalledWith(201);
    expect(marcarRecordatorioEnviado).not.toHaveBeenCalledWith(102);
  });

  it('no vuelve a enviar las citas ya marcadas (idempotencia)', async () => {
    // El repositorio excluye las citas con `recordatorioEnviado = true`.
    citasPorNegocio[NEGOCIO_A.id] = [cita(101, '09:30')];

    await cron.procesarRecordatorios();
    jest.clearAllMocks();
    obtenerCitasPendientesRecordatorio.mockResolvedValue([]);

    await cron.procesarRecordatorios();

    expect(enviarRecordatorioReserva).not.toHaveBeenCalled();
    expect(marcarRecordatorioEnviado).not.toHaveBeenCalled();
  });

  it('omite un negocio con WhatsApp desconectado sin detener los demas negocios', async () => {
    getStatus.mockImplementation((negocioId?: number) => ({
      conectado: negocioId === NEGOCIO_B.id,
    }));

    await cron.procesarRecordatorios();

    // Negocio A estaba desconectado: no se debió enviar su recordatorio
    expect(marcarRecordatorioEnviado).not.toHaveBeenCalledWith(101);
    // Negocio B estaba conectado: su recordatorio sí se debió enviar
    expect(marcarRecordatorioEnviado).toHaveBeenCalledWith(201);
  });
});

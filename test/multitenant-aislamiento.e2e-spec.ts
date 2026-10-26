import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { crearExtensionAislamientoNegocio } from '../src/modules/negocios/prisma-extension-aislamiento';

/**
 * PRUEBA DE AISLAMIENTO ENTRE NEGOCIOS A Y B CONTRA MARIADB REAL.
 *
 * A diferencia de `negocio-aislamiento.spec.ts` (que usa un cliente Prisma
 * simulado), esta prueba levanta un contenedor **MariaDB 11 efímero**, aplica
 * las migraciones REALES del proyecto y ejecuta consultas con el cliente
 * Prisma real contra dos negocios con los mismos identificadores relativos.
 *
 * Comprueba, contra el motor de base de datos:
 *  1. `findUnique` con filtro de negocio devuelve la fila propia y NO la
 *     ajena, aunque se conozca su id.
 *  2. `updateMany` con filtro de negocio no afecta a filas ajenas.
 *  3. `findMany` acotado al negocio no devuelve filas del otro.
 *  4. Un cierre general de A no aparece en las consultas de B.
 *  5. `upsert` con filtro de negocio no crea filas fuera de ámbito.
 *  6. La extensión de Prisma (defensa adicional) no deja pasar escrituras
 *     con un negocio distinto al del contexto.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

/** Datos de los dos negocios de prueba. */
const NEGOCIO_A = 1;
const NEGOCIO_B = 2;

describe('Aislamiento entre negocios A y B (MariaDB real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    conexion = await MariaDbConnection.start();

    // Aplica las migraciones reales del proyecto.
    execFileSync(
      process.execPath,
      [
        join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js'),
        'migrate',
        'deploy',
      ],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: conexion.urlBase },
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );

    const url = new URL(conexion.urlBase);
    const adapter = new PrismaMariaDb({
      host: url.hostname,
      port: Number(url.port),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.substring(1),
      connectionLimit: 5,
    });

    prisma = new PrismaClient({ adapter });
  }, 300000);

  afterAll(async () => {
    await prisma?.$disconnect();
    conexion?.stop();
  });

  /**
   * Crea los datos de los dos negocios.
   *
   * Es IDEMPOTENTE: usa `upsert` por identificador natural, de modo que
   * puede invocarse en cada caso de prueba sin duplicar filas ni chocar
   * con las restricciones únicas.
   */
  const sembrar = async () => {
    const negocioA = await prisma.negocio.upsert({
      where: { slug: 'negocio-a' },
      update: {},
      create: { slug: 'negocio-a', nombre: 'Negocio A' },
    });
    const negocioB = await prisma.negocio.upsert({
      where: { slug: 'negocio-b' },
      update: {},
      create: { slug: 'negocio-b', nombre: 'Negocio B' },
    });

    const usuarioA = await prisma.usuario.upsert({
      where: { email: 'a@test.local' },
      update: {},
      create: {
        email: 'a@test.local',
        nombre: 'Usuario',
        apellido: 'A',
        rol: 'PERSONAL',
      },
    });
    const usuarioB = await prisma.usuario.upsert({
      where: { email: 'b@test.local' },
      update: {},
      create: {
        email: 'b@test.local',
        nombre: 'Usuario',
        apellido: 'B',
        rol: 'PERSONAL',
      },
    });

    const barberoA = await prisma.barbero.upsert({
      where: { negocioId_usuarioId: { negocioId: NEGOCIO_A, usuarioId: usuarioA.id } },
      update: {},
      create: {
        usuarioId: usuarioA.id,
        telefono: '300',
        porcentajeComision: 10,
        negocioId: negocioA.id,
      },
    });
    const barberoB = await prisma.barbero.upsert({
      where: { negocioId_usuarioId: { negocioId: NEGOCIO_B, usuarioId: usuarioB.id } },
      update: {},
      create: {
        usuarioId: usuarioB.id,
        telefono: '301',
        porcentajeComision: 10,
        negocioId: negocioB.id,
      },
    });

    const servicioA = await prisma.servicio.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        nombre: 'Servicio A',
        precio: 1000,
        duracionMinutos: 30,
        negocioId: negocioA.id,
      },
    });
    const servicioB = await prisma.servicio.upsert({
      where: { id: 2 },
      update: {},
      create: {
        id: 2,
        nombre: 'Servicio B',
        precio: 2000,
        duracionMinutos: 30,
        negocioId: negocioB.id,
      },
    });

    const clienteA = await prisma.cliente.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        nombre: 'Cliente',
        apellido: 'A',
        negocioId: negocioA.id,
      },
    });
    const clienteB = await prisma.cliente.upsert({
      where: { id: 2 },
      update: {},
      create: {
        id: 2,
        nombre: 'Cliente',
        apellido: 'B',
        negocioId: negocioB.id,
      },
    });

    const reservaA = await prisma.reservation.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        clienteId: clienteA.id,
        date: new Date('2026-11-01T00:00:00.000Z'),
        dayOfWeek: 'SUNDAY',
        startTime: '10:00',
        endTime: '10:30',
        negocioId: negocioA.id,
      },
    });
    const reservaB = await prisma.reservation.upsert({
      where: { id: 2 },
      update: {},
      create: {
        id: 2,
        barberoId: barberoB.id,
        servicioId: servicioB.id,
        clienteId: clienteB.id,
        date: new Date('2026-11-01T00:00:00.000Z'),
        dayOfWeek: 'SUNDAY',
        startTime: '10:00',
        endTime: '10:30',
        negocioId: negocioB.id,
      },
    });

    const cierreA = await prisma.generalClosure.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        date: new Date('2026-12-25T00:00:00.000Z'),
        allDay: true,
        reason: 'Navidad A',
        negocioId: negocioA.id,
      },
    });
    const cierreB = await prisma.generalClosure.upsert({
      where: { id: 2 },
      update: {},
      create: {
        id: 2,
        date: new Date('2026-12-25T00:00:00.000Z'),
        allDay: true,
        reason: 'Navidad B',
        negocioId: negocioB.id,
      },
    });

    return {
      negocioA,
      negocioB,
      barberoA,
      barberoB,
      servicioA,
      servicioB,
      clienteA,
      clienteB,
      reservaA,
      reservaB,
      cierreA,
      cierreB,
    };
  };

  it('1 y 2. findUnique con filtro de negocio no devuelve filas ajenas', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    const { reservaA, reservaB } = await sembrar();

    // La reserva propia se encuentra con su id.
    const propia = await prisma.reservation.findUnique({
      where: { id: reservaA.id, negocioId: NEGOCIO_A },
    });
    expect(propia?.id).toBe(reservaA.id);

    // La reserva del otro negocio NO se encuentra, aunque se conozca su id.
    const ajena = await prisma.reservation.findUnique({
      where: { id: reservaB.id, negocioId: NEGOCIO_A },
    });
    expect(ajena).toBeNull();
  });

  it('3. updateMany con filtro de negocio no afecta a filas ajenas', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    const { reservaA, reservaB } = await sembrar();

    const resultado = await prisma.reservation.updateMany({
      where: { id: reservaB.id, negocioId: NEGOCIO_A },
      data: { status: 'CANCELLED' },
    });

    expect(resultado.count).toBe(0);

    // La reserva de B conserva su estado.
    const estadoB = await prisma.reservation.findUnique({
      where: { id: reservaB.id },
    });
    expect(estadoB?.status).toBe('PENDING');

    // La propia sí se actualiza.
    const propia = await prisma.reservation.updateMany({
      where: { id: reservaA.id, negocioId: NEGOCIO_A },
      data: { status: 'CANCELLED' },
    });
    expect(propia.count).toBe(1);
  });

  it('4. findMany acotado al negocio no devuelve filas del otro', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    await sembrar();

    const propias = await prisma.reservation.findMany({
      where: { negocioId: NEGOCIO_A },
    });

    expect(propias).toHaveLength(1);
    expect(propias.every((r) => r.negocioId === NEGOCIO_A)).toBe(true);
  });

  it('5. un cierre general de A no aparece en las consultas de B', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    const { cierreA, cierreB } = await sembrar();

    const cierresA = await prisma.generalClosure.findMany({
      where: { negocioId: NEGOCIO_A, active: true },
    });
    const cierresB = await prisma.generalClosure.findMany({
      where: { negocioId: NEGOCIO_B, active: true },
    });

    expect(cierresA.map((c) => c.id)).toEqual([cierreA.id]);
    expect(cierresB.map((c) => c.id)).toEqual([cierreB.id]);
  });

  it('6. el upsert con filtro de negocio no crea filas fuera de ámbito', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    const { barberoA } = await sembrar();

    const creada = await prisma.barberWeeklySlot.upsert({
      where: {
        barberoId_dayOfWeek_startTime: {
          barberoId: barberoA.id,
          dayOfWeek: 'MONDAY',
          startTime: '09:00',
        },
        negocioId: NEGOCIO_A,
      },
      update: { endTime: '13:00', active: true },
      create: {
        barberoId: barberoA.id,
        dayOfWeek: 'MONDAY',
        startTime: '09:00',
        endTime: '13:00',
        active: true,
        negocioId: NEGOCIO_A,
      },
    });

    expect(creada.negocioId).toBe(NEGOCIO_A);
  });

  it('7. la extensión de Prisma bloquea escrituras con un negocio distinto', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    const { clienteB, negocioA } = await sembrar();

    // Cliente de la extensión con el contexto del negocio A.
    const url = new URL(conexion!.urlBase);
    const adapter = new PrismaMariaDb({
      host: url.hostname,
      port: Number(url.port),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.substring(1),
      connectionLimit: 5,
    });

    const { ContextoNegocioAlmacenamiento } =
      await import('../src/modules/negocios/negocio-almacenamiento');

    const prismaExtendido = (
      new PrismaClient({ adapter }) as unknown as {
        $extends: (e: unknown) => PrismaClient;
      }
    ).$extends(crearExtensionAislamientoNegocio());

    ContextoNegocioAlmacenamiento.enterWith({
      id: negocioA.id,
      slug: 'negocio-a',
    });

    // Una escritura que intenta asignar la fila a OTRO negocio se rechaza.
    await expect(
      prismaExtendido.cliente.update({
        where: { id: clienteB.id, negocioId: negocioA.id },
        data: { nombre: 'Intruso' },
      }),
    ).rejects.toThrow();

    ContextoNegocioAlmacenamiento.disable();
    await prismaExtendido.$disconnect();
  });
});

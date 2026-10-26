import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { WeekDay } from '../generated/prisma/enums';
import { PrismaModule } from '../src/prisma/prisma.module';
import { NegociosModule } from '../src/modules/negocios/negocios.module';
import { ConfiguracionModule } from '../src/modules/configuracion/configuracion.module';
import { ConfiguracionService } from '../src/modules/configuracion/service/configuracion.service';
import { NegocioContextoService } from '../src/modules/negocios/negocio-contexto.service';
import { ReservasInfraModule } from '../src/modules/reservas/reservas-infra.module';
import { ReservasRepository } from '../src/modules/reservas/repository/reservas.repository';
import { WhatsAppPlantillasRepository } from '../src/modules/whatsapp/whatsapp-plantillas.repository';
import { CLAVES_CONFIGURACION } from '../src/modules/configuracion/configuracion.constants';

/**
 * HU-11 CONTRA MARIADB REAL: PLANTILLAS, CONFIGURACIÓN Y PROCESO DE FONDO.
 *
 * Levanta un contenedor **MariaDB 11 efímero**, aplica las migraciones REALES
 * (incluida la de HU-11) y comprueba, contra el motor de base de datos:
 *
 *  1. Las plantillas sin negocio son GLOBALES y las ven todos los negocios.
 *  2. Cada negocio tiene sus PROPIAS plantillas; las de A no afectan a B.
 *  3. La plantilla GLOBAL de plataforma es visible para todos.
 *  4. Como máximo hay UNA plantilla global por tipo y UNA por negocio y tipo.
 *  5. El camino de datos del cron está acotado al negocio del contexto.
 *  6. Sin contexto, el camino de datos del cron FALLA (no degrada a "todos").
 *  7. Marcar un recordatorio en el contexto de A NO marca la reserva de B.
 *  8. La dirección y la anticipación son políticas POR NEGOCIO.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const FECHA = '2026-11-02'; // lunes
const HORA = '10:00';

describe('HU-11: plantillas, configuración y cron por negocio (MariaDB real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prisma: PrismaClient;
  let app: INestApplication;
  let contextoService: NegocioContextoService;
  let configuracionService: ConfiguracionService;
  let plantillasRepository: WhatsAppPlantillasRepository;
  let reservasRepository: ReservasRepository;

  beforeAll(async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    conexion = await MariaDbConnection.start();

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

    process.env.DATABASE_URL = conexion.urlBase;

    // Cliente Prisma SIN la extensión de aislamiento: la siembra de datos
    // ocurre fuera de una petición, sin contexto de negocio.
    const url = new URL(conexion.urlBase);
    prisma = new PrismaClient({
      adapter: new PrismaMariaDb({
        host: url.hostname,
        port: Number(url.port),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.substring(1),
        connectionLimit: 5,
      }),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        NegociosModule,
        ConfiguracionModule,
        ReservasInfraModule,
      ],
      providers: [WhatsAppPlantillasRepository],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    contextoService = app.get(NegocioContextoService);
    configuracionService = app.get(ConfiguracionService);
    plantillasRepository = app.get(WhatsAppPlantillasRepository);
    reservasRepository = app.get(ReservasRepository);
  }, 300000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();
  });

  /**
   * Siembra dos barberías con reservas y datos SEPARADOS.
   */
  const sembrar = async () => {
    const kyrios = await prisma.negocio.upsert({
      where: { slug: 'kyrios-studio' },
      update: {},
      create: { slug: 'kyrios-studio', nombre: 'KYRIOS STUDIO' },
    });
    const negocioB = await prisma.negocio.upsert({
      where: { slug: 'negocio-b' },
      update: {},
      create: { slug: 'negocio-b', nombre: 'Negocio B' },
    });

    const crearUsuario = async (email: string) =>
      prisma.usuario.upsert({
        where: { email },
        update: {},
        create: {
          email,
          nombre: 'Persona',
          apellido: 'Prueba',
          rol: 'PERSONAL',
        },
      });

    const barberoAUsuario = await crearUsuario('hu11-barbero-a@pruebas.local');
    const barberoBUsuario = await crearUsuario('hu11-barbero-b@pruebas.local');

    const barberoA = await prisma.barbero.upsert({
      where: {
        negocioId_usuarioId: {
          negocioId: kyrios.id,
          usuarioId: barberoAUsuario.id,
        },
      },
      update: {},
      create: {
        usuarioId: barberoAUsuario.id,
        telefono: '3000000011',
        porcentajeComision: 10,
        negocioId: kyrios.id,
      },
    });
    const barberoB = await prisma.barbero.upsert({
      where: {
        negocioId_usuarioId: {
          negocioId: negocioB.id,
          usuarioId: barberoBUsuario.id,
        },
      },
      update: {},
      create: {
        usuarioId: barberoBUsuario.id,
        telefono: '3000000012',
        porcentajeComision: 10,
        negocioId: negocioB.id,
      },
    });

    const servicioA = await prisma.servicio.upsert({
      where: { id: 101 },
      update: {},
      create: {
        id: 101,
        nombre: 'Corte HU-11 A',
        precio: 20000,
        duracionMinutos: 30,
        negocioId: kyrios.id,
      },
    });
    const servicioB = await prisma.servicio.upsert({
      where: { id: 102 },
      update: {},
      create: {
        id: 102,
        nombre: 'Corte HU-11 B',
        precio: 25000,
        duracionMinutos: 30,
        negocioId: negocioB.id,
      },
    });

    const clienteA = await prisma.cliente.upsert({
      where: { id: 201 },
      update: {},
      create: {
        id: 201,
        nombre: 'Cliente',
        apellido: 'A',
        telefono: '3001111111',
        negocioId: kyrios.id,
      },
    });
    const clienteB = await prisma.cliente.upsert({
      where: { id: 202 },
      update: {},
      create: {
        id: 202,
        nombre: 'Cliente',
        apellido: 'B',
        telefono: '3002222222',
        negocioId: negocioB.id,
      },
    });

    await prisma.reservation.deleteMany({
      where: { id: { in: [301, 302] } },
    });

    const reservaA = await prisma.reservation.create({
      data: {
        id: 301,
        date: new Date(`${FECHA}T00:00:00.000Z`),
        dayOfWeek: WeekDay.MONDAY,
        startTime: HORA,
        endTime: '10:30',
        status: 'PENDING',
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        clienteId: clienteA.id,
        negocioId: kyrios.id,
        recordatorioEnviado: false,
      },
    });
    const reservaB = await prisma.reservation.create({
      data: {
        id: 302,
        date: new Date(`${FECHA}T00:00:00.000Z`),
        dayOfWeek: WeekDay.MONDAY,
        startTime: HORA,
        endTime: '10:30',
        status: 'PENDING',
        barberoId: barberoB.id,
        servicioId: servicioB.id,
        clienteId: clienteB.id,
        negocioId: negocioB.id,
        recordatorioEnviado: false,
      },
    });

    return { kyrios, negocioB, reservaA, reservaB };
  };

  /** Ejecuta una operación como si la petición fuera del negocio indicado. */
  const enContexto = <T>(
    negocio: { id: number; slug: string },
    operacion: () => Promise<T>,
  ) => contextoService.ejecutarEnContexto(negocio, operacion);

  it('1. las plantillas sin negocio son GLOBALES y las ven todos los negocios', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB } = await sembrar();

    // Fila creada como lo haría la aplicación anterior a HU-11 (sin
    // `negocioId`): la migración no reasigna ni elimina las filas existentes,
    // quedan como GLOBALES de plataforma.
    await prisma.whatsAppPlantilla.create({
      data: { tipo: 'CONFIRMACION', mensaje: 'Texto global heredado' },
    });

    const filas = await prisma.whatsAppPlantilla.findMany({
      where: { tipo: 'CONFIRMACION' },
      select: { tipo: true, negocioId: true },
    });

    expect(filas.length).toBe(1);
    expect(filas[0].negocioId).toBeNull();

    // La global es visible para cualquier negocio.
    const deA = await plantillasRepository.obtenerPlantillas(kyrios.id);
    const deB = await plantillasRepository.obtenerPlantillas(negocioB.id);
    expect(deA.find((p) => p.tipo === 'CONFIRMACION')?.mensaje).toBe(
      'Texto global heredado',
    );
    expect(deB.find((p) => p.tipo === 'CONFIRMACION')?.mensaje).toBe(
      'Texto global heredado',
    );
  });

  it('2 y 3. cada negocio tiene sus propias plantillas y ve la global', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB } = await sembrar();

    await plantillasRepository.guardarPlantilla(
      null,
      'CONFIRMACION',
      'Texto global de plataforma',
    );
    await plantillasRepository.guardarPlantilla(
      kyrios.id,
      'CONFIRMACION',
      'Texto propio de A',
    );

    const deA = await plantillasRepository.obtenerPlantillas(kyrios.id);
    const deB = await plantillasRepository.obtenerPlantillas(negocioB.id);

    const confirmacionA = deA.find((p) => p.tipo === 'CONFIRMACION');
    const confirmacionB = deB.find((p) => p.tipo === 'CONFIRMACION');

    // A ve la suya; B ve la global (no la de A).
    expect(confirmacionA?.mensaje).toBe('Texto propio de A');
    expect(confirmacionB?.mensaje).toBe('Texto global de plataforma');
  });

  it('2b. una plantilla DESACTIVADA se ignora (como antes de HU-11)', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios } = await sembrar();

    await plantillasRepository.guardarPlantilla(
      kyrios.id,
      'RECORDATORIO',
      'Recordatorio desactivado',
    );
    await prisma.whatsAppPlantilla.updateMany({
      where: { negocioId: kyrios.id, tipo: 'RECORDATORIO' },
      data: { activo: false },
    });

    const plantillas = await plantillasRepository.obtenerPlantillas(kyrios.id);
    expect(
      plantillas.find(
        (p) => p.tipo === 'RECORDATORIO' && p.negocioId === kyrios.id,
      ),
    ).toBeUndefined();
  });

  it('4. como máximo hay una global por tipo y una por negocio y tipo', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB } = await sembrar();

    await plantillasRepository.guardarPlantilla(
      null,
      'RECORDATORIO',
      'Recordatorio global',
    );

    // Una segunda global del mismo tipo NO puede existir.
    await expect(
      prisma.whatsAppPlantilla.create({
        data: { tipo: 'RECORDATORIO', mensaje: 'otro global', negocioId: null },
      }),
    ).rejects.toBeTruthy();

    // Dos negocios SÍ pueden tener su propio recordatorio.
    await plantillasRepository.guardarPlantilla(
      kyrios.id,
      'RECORDATORIO',
      'Recordatorio de A',
    );
    await plantillasRepository.guardarPlantilla(
      negocioB.id,
      'RECORDATORIO',
      'Recordatorio de B',
    );

    // Pero el mismo negocio no puede duplicar el tipo.
    await expect(
      prisma.whatsAppPlantilla.create({
        data: {
          tipo: 'RECORDATORIO',
          mensaje: 'duplicado',
          negocioId: kyrios.id,
        },
      }),
    ).rejects.toBeTruthy();
  });

  it('5. el camino de datos del cron está acotado al negocio del contexto', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB, reservaA, reservaB } = await sembrar();

    const citasA = await enContexto(kyrios, () =>
      reservasRepository.obtenerCitasPendientesRecordatorio(
        new Date(`${FECHA}T00:00:00.000Z`),
      ),
    );
    const citasB = await enContexto(negocioB, () =>
      reservasRepository.obtenerCitasPendientesRecordatorio(
        new Date(`${FECHA}T00:00:00.000Z`),
      ),
    );

    const idsA = citasA.map((c) => c.id);
    const idsB = citasB.map((c) => c.id);

    expect(idsA).toContain(reservaA.id);
    expect(idsA).not.toContain(reservaB.id);
    expect(idsB).toContain(reservaB.id);
    expect(idsB).not.toContain(reservaA.id);
  });

  it('6. sin contexto, el camino de datos del cron FALLA', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    await expect(
      reservasRepository.obtenerCitasPendientesRecordatorio(
        new Date(`${FECHA}T00:00:00.000Z`),
      ),
    ).rejects.toBeTruthy();
  });

  it('7. marcar un recordatorio en el contexto de A NO marca la reserva de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, reservaB } = await sembrar();

    await enContexto(kyrios, () =>
      reservasRepository.marcarRecordatorioEnviado(reservaB.id),
    );

    const reserva = await prisma.reservation.findUnique({
      where: { id: reservaB.id },
      select: { recordatorioEnviado: true },
    });

    expect(reserva?.recordatorioEnviado).toBe(false);
  });

  it('8. la dirección y la anticipación son políticas POR NEGOCIO', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB } = await sembrar();
    configuracionService.invalidarCache();

    await configuracionService.guardarTexto(
      kyrios.id,
      CLAVES_CONFIGURACION.NEGOCIO_DIRECCION,
      'Carrera 6 # 3-45, Popayán',
    );
    await configuracionService.guardarTexto(
      negocioB.id,
      CLAVES_CONFIGURACION.NEGOCIO_DIRECCION,
      'Calle 9 # 8-20, Cali',
    );
    await configuracionService.guardarNumero(
      kyrios.id,
      CLAVES_CONFIGURACION.RECORDATORIO_MINUTOS_ANTICIPACION,
      45,
    );

    configuracionService.invalidarCache();

    const direccionA = await enContexto(kyrios, () =>
      configuracionService.obtenerTexto(
        CLAVES_CONFIGURACION.NEGOCIO_DIRECCION,
        '',
      ),
    );
    const direccionB = await enContexto(negocioB, () =>
      configuracionService.obtenerTexto(
        CLAVES_CONFIGURACION.NEGOCIO_DIRECCION,
        '',
      ),
    );
    const anticipacionA = await enContexto(kyrios, () =>
      configuracionService.obtenerNumero(
        CLAVES_CONFIGURACION.RECORDATORIO_MINUTOS_ANTICIPACION,
        120,
      ),
    );

    expect(direccionA).toBe('Carrera 6 # 3-45, Popayán');
    expect(direccionB).toBe('Calle 9 # 8-20, Cali');
    expect(anticipacionA).toBe(45);
  });

  it('9. eliminar un negocio elimina SUS plantillas y conserva las demás', async () => {
    if (OMITIR_SIN_DOCKER) return;

    // Negocios NUEVOS (sin reservas ni clientes) para poder borrarlos: las
    // FK de la Fase 8 son RESTRICT y no permiten borrar un negocio con datos.
    const negocioA = await prisma.negocio.create({
      data: { slug: 'hu11-cascade-a', nombre: 'Cascade A' },
    });
    const negocioB = await prisma.negocio.create({
      data: { slug: 'hu11-cascade-b', nombre: 'Cascade B' },
    });

    await prisma.whatsAppPlantilla.create({
      data: { tipo: 'CASCADA', mensaje: 'Plantilla global' },
    });
    await prisma.whatsAppPlantilla.create({
      data: {
        tipo: 'CASCADA',
        mensaje: 'Plantilla de A',
        negocioId: negocioA.id,
      },
    });
    await prisma.whatsAppPlantilla.create({
      data: {
        tipo: 'CASCADA',
        mensaje: 'Plantilla de B',
        negocioId: negocioB.id,
      },
    });

    // Se borra el negocio A: la FK ON DELETE CASCADE elimina SUS plantillas.
    await prisma.negocio.delete({ where: { id: negocioA.id } });

    const restantes = await prisma.whatsAppPlantilla.findMany({
      where: { tipo: 'CASCADA' },
      select: { mensaje: true, negocioId: true },
    });

    // La global permanece y la de B permanece; la de A ya no está.
    expect(restantes.map((p) => p.mensaje).sort()).toEqual([
      'Plantilla de B',
      'Plantilla global',
    ]);
    expect(
      restantes.find((p) => p.negocioId === negocioA.id),
    ).toBeUndefined();
  });
});

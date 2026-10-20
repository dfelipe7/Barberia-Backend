import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NotFoundException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaModule } from '../src/prisma/prisma.module';
import { NegociosModule } from '../src/modules/negocios/negocios.module';
import { NegocioContextoMiddleware } from '../src/modules/negocios/middleware/negocio-contexto.middleware';
import { AuthModule } from '../src/auth/auth.module';
import { ServiciosModule } from '../src/modules/servicios/servicios.module';
import { ServiciosService } from '../src/modules/servicios/service/servicios.service';
import { UsuariosModule } from '../src/modules/usuarios/usuarios.module';
import { HorariosModule } from '../src/modules/horarios/horarios.module';
import { NegocioContextoService } from '../src/modules/negocios/negocio-contexto.service';

/**
 * PRUEBA DE CATÁLOGOS Y DISPONIBILIDAD AISLADOS POR NEGOCIO (Fase 6) CONTRA
 * MARIADB REAL.
 *
 * Levanta un contenedor **MariaDB 11 efímero**, aplica las migraciones REALES y
 * monta la aplicación con los módulos reales (catálogo de servicios, catálogo
 * de barberos y disponibilidad), con el middleware de contexto de negocio.
 *
 * Escenarios:
 *  1. `GET /servicios` en A solo devuelve servicios de A.
 *  2. Los barberos que devuelve un servicio usan `Barbero.id`.
 *  3. La consulta de servicios por barbero utiliza `Barbero.id`.
 *  4. La disponibilidad de un barbero de B consultada desde A falla de forma
 *     segura (404).
 *  5. Los horarios y cierres de A no modifican la disponibilidad de B.
 *  6. No se puede asignar un barbero de B a un servicio de A.
 *  7. Una ruta con un contexto de negocio inválido no consulta información
 *     tenant-scoped (404 del middleware).
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const FECHA = '2026-11-02'; // lunes

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ServiciosModule,
    UsuariosModule,
    HorariosModule,
    NegociosModule,
    PrismaModule,
  ],
})
class CatalogoTestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Catálogos y disponibilidad aislados por negocio (MariaDB real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prisma: PrismaClient;
  let app: INestApplication<App>;
  let serviciosService: ServiciosService;
  let contextoService: NegocioContextoService;

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
    // El verificador de Google solo necesita un identificador de cliente para
    // construir su OAuth2Client: en esta prueba no se verifica ningún token.
    process.env.GOOGLE_CLIENT_ID = 'pruebas-catalogo';

    // Cliente Prisma SIN la extensión de aislamiento: la siembra ocurre fuera
    // de una petición, sin contexto de negocio.
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
      imports: [CatalogoTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    serviciosService = app.get(ServiciosService);
    contextoService = app.get(NegocioContextoService);
  }, 300000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();
  });

  /**
   * Siembra dos barberías con sus barberos, servicios, horarios y cierres.
   *
   * `kyrios-studio` representa al primer negocio real (KYRIOS STUDIO).
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
          apellido: email,
          rol: 'PERSONAL',
        },
      });

    const usuarioA = await crearUsuario('barbero-a@test.local');
    const usuarioB = await crearUsuario('barbero-b@test.local');

    const barberoA = await prisma.barbero.upsert({
      where: { negocioId_usuarioId: { negocioId: kyrios.id, usuarioId: usuarioA.id } },
      update: {},
      create: {
        usuarioId: usuarioA.id,
        telefono: '300',
        porcentajeComision: 10,
        negocioId: kyrios.id,
      },
    });
    const barberoB = await prisma.barbero.upsert({
      where: { negocioId_usuarioId: { negocioId: negocioB.id, usuarioId: usuarioB.id } },
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
        nombre: 'Corte KYRIOS',
        precio: 20000,
        duracionMinutos: 30,
        negocioId: kyrios.id,
      },
    });
    const servicioB = await prisma.servicio.upsert({
      where: { id: 2 },
      update: {},
      create: {
        id: 2,
        nombre: 'Corte Negocio B',
        precio: 25000,
        duracionMinutos: 30,
        negocioId: negocioB.id,
      },
    });

    await prisma.barberoServicio.deleteMany({});
    await prisma.barberoServicio.create({
      data: {
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        negocioId: kyrios.id,
      },
    });
    await prisma.barberoServicio.create({
      data: {
        barberoId: barberoB.id,
        servicioId: servicioB.id,
        negocioId: negocioB.id,
      },
    });

    // Horario semanal de lunes 09:00-13:00 para cada barbero. La regla de
    // horario semanal compara por hora de INICIO, así que cada hora de la
    // jornada es una franja propia.
    const franjasDelDia: Array<[string, string]> = [
      ['09:00', '10:00'],
      ['10:00', '11:00'],
      ['11:00', '12:00'],
      ['12:00', '13:00'],
    ];

    await prisma.barberWeeklySlot.deleteMany({});
    for (const barbero of [barberoA, barberoB]) {
      for (const [inicio, fin] of franjasDelDia) {
        await prisma.barberWeeklySlot.create({
          data: {
            barberoId: barbero.id,
            negocioId: barbero.negocioId,
            dayOfWeek: 'MONDAY',
            startTime: inicio,
            endTime: fin,
            active: true,
          },
        });
      }
    }

    // Cierre general SOLO en la barbería A.
    await prisma.generalClosure.deleteMany({});
    await prisma.generalClosure.create({
      data: {
        negocioId: kyrios.id,
        date: new Date(`${FECHA}T00:00:00.000Z`),
        allDay: true,
        reason: 'Mantenimiento KYRIOS',
        active: true,
      },
    });

    return { kyrios, negocioB, barberoA, barberoB, servicioA, servicioB };
  };

  it('1. GET /servicios en A solo devuelve servicios de A', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const respuesta = await request(app.getHttpServer())
      .get('/servicios')
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(respuesta.status).toBe(200);
    const servicios = respuesta.body as Array<{ id: number; nombre: string }>;
    expect(servicios.map((s) => s.id)).toEqual([1]);
    expect(servicios.map((s) => s.nombre)).toEqual(['Corte KYRIOS']);
  });

  it('2. los barberos que devuelve un servicio usan Barbero.id', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoA } = await sembrar();

    const respuesta = await request(app.getHttpServer())
      .get('/servicios')
      .set('X-Negocio-Slug', 'kyrios-studio');

    const servicios = respuesta.body as Array<{
      barberos: Array<{ id: number }>;
    }>;
    // El id publicado es el del perfil de barbero, NO el del usuario.
    expect(servicios[0].barberos[0].id).toBe(barberoA.id);
  });

  it('3. la consulta de servicios por barbero utiliza Barbero.id', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoA, barberoB } = await sembrar();

    const enA = await request(app.getHttpServer())
      .get(`/servicios/barbero/${barberoA.id}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(enA.status).toBe(200);
    expect((enA.body as Array<{ id: number }>).map((s) => s.id)).toEqual([1]);

    // Un barbero de B no existe para A: 404, sin revelar nada.
    const ajeno = await request(app.getHttpServer())
      .get(`/servicios/barbero/${barberoB.id}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(ajeno.status).toBe(404);
  });

  it('4. la disponibilidad de un barbero de B consultada desde A falla de forma segura', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoA, barberoB } = await sembrar();

    const ajeno = await request(app.getHttpServer())
      .get(`/usuarios/barberos/${barberoB.id}/disponibilidad`)
      .query({ fecha: FECHA })
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(ajeno.status).toBe(404);

    // El barbero de A sí responde (y con el cierre de A, sin franjas libres).
    const propio = await request(app.getHttpServer())
      .get(`/usuarios/barberos/${barberoA.id}/disponibilidad`)
      .query({ fecha: FECHA })
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(propio.status).toBe(200);
  });

  it('5. los horarios y cierres de A no modifican la disponibilidad de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoB } = await sembrar();

    // El cierre general de A no afecta a B: sus franjas siguen libres.
    const disponibilidadB = await request(app.getHttpServer())
      .get(`/usuarios/barberos/${barberoB.id}/disponibilidad`)
      .query({ fecha: FECHA })
      .set('X-Negocio-Slug', 'negocio-b');

    expect(disponibilidadB.status).toBe(200);
    const franjas = (
      disponibilidadB.body as { slots: Array<{ startTime: string }> }
    ).slots;
    // 09:00-13:00 en bloques de 60 minutos: 4 franjas libres.
    expect(franjas.length).toBe(4);
    expect(franjas.map((f) => f.startTime)).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '12:00',
    ]);
  });

  it('6. no se puede asignar un barbero de B a un servicio de A', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, barberoB } = await sembrar();

    await expect(
      contextoService.ejecutarEnContexto(kyrios, () =>
        serviciosService.crearServicio({
          nombre: 'Servicio con barbero ajeno',
          precio: 10000,
          duracionMinutos: 30,
          barberoIds: [barberoB.id],
        }),
      ),
    ).rejects.toThrow('Uno o más barberos seleccionados no existen');
  });

  it('7. una ruta con un contexto de negocio inválido no consulta información tenant-scoped', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const negocioInexistente = await request(app.getHttpServer())
      .get('/servicios')
      .set('X-Negocio-Slug', 'no-existe');

    expect(negocioInexistente.status).toBe(404);

    const barberoInexistente = await request(app.getHttpServer())
      .get('/usuarios/barberos')
      .set('X-Negocio-Slug', 'no-existe');

    expect(barberoInexistente.status).toBe(404);
  });
});

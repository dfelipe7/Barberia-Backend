import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Response } from 'supertest';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { TipoDescuento, WeekDay } from '../generated/prisma/enums';
import { AuthModule } from '../src/auth/auth.module';
import { GoogleTokenVerifier } from '../src/auth/google/google-token-verifier.service';
import { DescuentosModule } from '../src/modules/descuentos/descuentos.module';
import { NegocioContextoMiddleware } from '../src/modules/negocios/middleware/negocio-contexto.middleware';
import { NegociosModule } from '../src/modules/negocios/negocios.module';
import { PrismaModule } from '../src/prisma/prisma.module';

/**
 * HE-10-HU-02 contra MySQL 8.0 REAL: creación del descuento único por
 * producto o servicio.
 *
 * Solo se sustituye la verificación criptográfica de Google. El resto de la
 * cadena (middleware de contexto, guards, DTOs, Prisma, extensión de
 * aislamiento) es la real.
 */
const SECRETO_PERSONAL = 'secreto-personal-descuentos-e2e';
const SLUG_A = 'descuentos-negocio-a';
const SLUG_B = 'descuentos-negocio-b';

interface SesionEmitida {
  accessToken?: string;
}

interface DescuentoCreado {
  mensaje: string;
  descuento: {
    id: number;
    tipo: TipoDescuento;
    elemento: { id: number; nombre: string };
    porcentaje: number;
    diasSemana: WeekDay[];
    activo: boolean;
    creadoEn?: string;
    actualizadoEn?: string;
  };
}

function cuerpo<T>(respuesta: Response): T {
  return (respuesta.body ?? {}) as T;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    NegociosModule,
    PrismaModule,
    DescuentosModule,
  ],
})
class PruebaDescuentosModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Descuentos: crear descuento único por elemento (MySQL 8.0 real)', () => {
  let conexion: MariaDbConnection | undefined;
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let negocioA: { id: number; slug: string };
  let negocioB: { id: number; slug: string };
  let productoA: { id: number; nombre: string };
  let productoB: { id: number; nombre: string };
  let servicioA: { id: number; nombre: string };
  let servicioB: { id: number; nombre: string };

  let tokenAdminA: string | undefined;
  let tokenAdminB: string | undefined;
  let tokenSuperadminA: string | undefined;
  let tokenBarberoA: string | undefined;

  const verificarGoogle = jest.fn((idToken: string) =>
    Promise.resolve({
      sub: `sub-${idToken}`,
      email: idToken,
      email_verified: true,
      given_name: 'Persona',
    }),
  );

  beforeAll(async () => {
    if (process.env.MARIADB_TEST_SKIP === '1') {
      throw new Error(
        'La suite multitenant-descuentos exige Docker/MariaDB. ' +
          'MARIADB_TEST_SKIP=1 no está permitido en esta suite porque ocultaría ' +
          'el aislamiento real. Ver AGENTS.md §12.1.',
      );
    }

    conexion = await MariaDbConnection.start({
      motor: 'mysql',
      lowerCaseTableNames: false,
    });

    execFileSync(
      process.execPath,
      [
        path.join(
          __dirname,
          '..',
          'node_modules',
          'prisma',
          'build',
          'index.js',
        ),
        'migrate',
        'deploy',
      ],
      {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: conexion.urlBase },
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );

    process.env.DATABASE_URL = conexion.urlBase;
    process.env.JWT_SECRET = SECRETO_PERSONAL;
    process.env.NEGOCIO_PERMITIR_HEADER_SLUG = 'true';

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
      imports: [PruebaDescuentosModule],
    })
      .overrideProvider(GoogleTokenVerifier)
      .useValue({ verificar: verificarGoogle })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    negocioA = await prisma.negocio.upsert({
      where: { slug: SLUG_A },
      update: {},
      create: { slug: SLUG_A, nombre: 'Descuentos Negocio A' },
    });
    negocioB = await prisma.negocio.upsert({
      where: { slug: SLUG_B },
      update: {},
      create: { slug: SLUG_B, nombre: 'Descuentos Negocio B' },
    });

    const crearUsuario = (email: string) =>
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

    const adminA = await crearUsuario('descuentos-admin-a@test.local');
    const adminB = await crearUsuario('descuentos-admin-b@test.local');
    const superadminA = await crearUsuario(
      'descuentos-superadmin-a@test.local',
    );
    const barberoA = await crearUsuario('descuentos-barbero-a@test.local');

    for (const [negocio, usuario] of [
      [negocioA, adminA],
      [negocioB, adminB],
    ] as const) {
      await prisma.administrador.upsert({
        where: {
          negocioId_usuarioId: { negocioId: negocio.id, usuarioId: usuario.id },
        },
        update: {},
        create: {
          usuarioId: usuario.id,
          negocioId: negocio.id,
          superadmin: false,
        },
      });
    }

    await prisma.administrador.upsert({
      where: {
        negocioId_usuarioId: {
          negocioId: negocioA.id,
          usuarioId: superadminA.id,
        },
      },
      update: { superadmin: true },
      create: {
        usuarioId: superadminA.id,
        negocioId: negocioA.id,
        superadmin: true,
      },
    });

    await prisma.barbero.upsert({
      where: {
        negocioId_usuarioId: {
          negocioId: negocioA.id,
          usuarioId: barberoA.id,
        },
      },
      update: {},
      create: {
        usuarioId: barberoA.id,
        negocioId: negocioA.id,
        telefono: '3000000000',
        porcentajeComision: 50,
      },
    });

    tokenAdminA = await login('descuentos-admin-a@test.local', SLUG_A);
    tokenAdminB = await login('descuentos-admin-b@test.local', SLUG_B);
    tokenSuperadminA = await login(
      'descuentos-superadmin-a@test.local',
      SLUG_A,
    );
    tokenBarberoA = await login('descuentos-barbero-a@test.local', SLUG_A);
  }, 300000);

  beforeEach(async () => {
    await prisma.descuento.deleteMany({
      where: { negocioId: { in: [negocioA.id, negocioB.id] } },
    });
    await prisma.producto.deleteMany({
      where: { negocioId: { in: [negocioA.id, negocioB.id] } },
    });
    await prisma.servicio.deleteMany({
      where: { negocioId: { in: [negocioA.id, negocioB.id] } },
    });

    productoA = await prisma.producto.create({
      data: {
        negocioId: negocioA.id,
        nombre: 'Cera A',
        precio: 35000,
      },
    });
    productoB = await prisma.producto.create({
      data: {
        negocioId: negocioB.id,
        nombre: 'Cera B',
        precio: 35000,
      },
    });
    servicioA = await prisma.servicio.create({
      data: {
        negocioId: negocioA.id,
        nombre: 'Corte A',
        precio: 25000,
        duracionMinutos: 30,
      },
    });
    servicioB = await prisma.servicio.create({
      data: {
        negocioId: negocioB.id,
        nombre: 'Corte B',
        precio: 25000,
        duracionMinutos: 30,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();
  });

  const login = async (
    email: string,
    slug: string,
  ): Promise<string | undefined> => {
    const respuesta = await request(app.getHttpServer())
      .post('/auth/google')
      .set('X-Negocio-Slug', slug)
      .send({ idToken: email });

    return cuerpo<SesionEmitida>(respuesta).accessToken;
  };

  const crear = (
    token: string | undefined,
    slug: string,
    campos: Record<string, unknown>,
  ) => {
    let peticion = request(app.getHttpServer())
      .post('/descuentos')
      .set('X-Negocio-Slug', slug);

    if (token) {
      peticion = peticion.set('Authorization', `Bearer ${token}`);
    }

    return peticion.send(campos);
  };

  const dtoProductoA = {
    tipo: TipoDescuento.PRODUCTO,
    elementoId: 0,
    porcentaje: 10.25,
    diasSemana: [WeekDay.MONDAY, WeekDay.FRIDAY],
  };

  it('HE-10-HU-02-CA-01: ADMINISTRADOR y SUPERADMIN del negocio crean; barbero recibe 403', async () => {
    const sinToken = await crear(undefined, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
    });
    expect(sinToken.status).toBe(401);

    const barbero = await crear(tokenBarberoA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
    });
    expect(barbero.status).toBe(403);

    const superadmin = await crear(tokenSuperadminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
    });
    expect(superadmin.status).toBe(201);

    const admin = await crear(tokenAdminA, SLUG_A, {
      tipo: TipoDescuento.SERVICIO,
      elementoId: servicioA.id,
      porcentaje: 20,
      diasSemana: [WeekDay.WEDNESDAY],
    });
    expect(admin.status).toBe(201);
  });

  it('HE-10-HU-02-CA-01: rechaza negocioId y activo enviados por el cliente', async () => {
    const conNegocio = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
      negocioId: negocioB.id,
    });
    expect(conNegocio.status).toBe(400);

    const conActivo = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
      activo: true,
    });
    expect(conActivo.status).toBe(400);
  });

  it('HE-10-HU-02-CA-02: crea un descuento válido de producto y responde el elemento', async () => {
    const respuesta = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
    });

    expect(respuesta.status).toBe(201);
    const creado = cuerpo<DescuentoCreado>(respuesta);
    expect(creado.mensaje).toBe('Descuento creado correctamente');
    expect(creado.descuento.tipo).toBe(TipoDescuento.PRODUCTO);
    expect(creado.descuento.elemento).toEqual({
      id: productoA.id,
      nombre: productoA.nombre,
    });
    expect(creado.descuento.porcentaje).toBe(10.25);
    expect(creado.descuento.diasSemana).toEqual([
      WeekDay.MONDAY,
      WeekDay.FRIDAY,
    ]);
  });

  it('HE-10-HU-02-CA-02: crea un descuento válido de servicio', async () => {
    const respuesta = await crear(tokenAdminA, SLUG_A, {
      tipo: TipoDescuento.SERVICIO,
      elementoId: servicioA.id,
      porcentaje: 15,
      diasSemana: [WeekDay.TUESDAY],
    });

    expect(respuesta.status).toBe(201);
    const creado = cuerpo<DescuentoCreado>(respuesta);
    expect(creado.descuento.tipo).toBe(TipoDescuento.SERVICIO);
    expect(creado.descuento.elemento).toEqual({
      id: servicioA.id,
      nombre: servicioA.nombre,
    });
  });

  it('HE-10-HU-02-CA-03: acepta 1 y 99 y rechaza 0 y 100', async () => {
    const minimo = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
      porcentaje: 1,
    });
    expect(minimo.status).toBe(201);

    const maximo = await crear(tokenAdminA, SLUG_A, {
      tipo: TipoDescuento.SERVICIO,
      elementoId: servicioA.id,
      porcentaje: 99,
      diasSemana: [WeekDay.MONDAY],
    });
    expect(maximo.status).toBe(201);

    const cero = await crear(tokenAdminA, SLUG_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoB.id,
      porcentaje: 0,
      diasSemana: [WeekDay.MONDAY],
    });
    expect(cero.status).toBe(400);

    const cien = await crear(tokenAdminA, SLUG_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoB.id,
      porcentaje: 100,
      diasSemana: [WeekDay.MONDAY],
    });
    expect(cien.status).toBe(400);
  });

  it('HE-10-HU-02-CA-04: exige al menos un día y rechaza días inválidos', async () => {
    const vacio = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
      diasSemana: [],
    });
    expect(vacio.status).toBe(400);

    const ausente = await crear(tokenAdminA, SLUG_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoA.id,
      porcentaje: 10,
    });
    expect(ausente.status).toBe(400);

    const invalido = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
      diasSemana: ['FUNDAY'],
    });
    expect(invalido.status).toBe(400);
  });

  it('HE-10-HU-02-CA-04: normaliza días duplicados y los ordena', async () => {
    const respuesta = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
      diasSemana: [WeekDay.FRIDAY, WeekDay.MONDAY, WeekDay.FRIDAY],
    });

    expect(respuesta.status).toBe(201);
    expect(cuerpo<DescuentoCreado>(respuesta).descuento.diasSemana).toEqual([
      WeekDay.MONDAY,
      WeekDay.FRIDAY,
    ]);
  });

  it('HE-10-HU-02-CA-05/CA-09: rechaza un segundo descuento para el mismo elemento', async () => {
    const primero = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
    });
    expect(primero.status).toBe(201);

    const segundo = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
      porcentaje: 5,
    });
    expect(segundo.status).toBe(409);

    const total = await prisma.descuento.count({
      where: { negocioId: negocioA.id, productoId: productoA.id },
    });
    expect(total).toBe(1);
  });

  it('HE-10-HU-02-CA-05/CA-09: dos altas simultáneas dejan un solo descuento', async () => {
    const [primera, segunda] = await Promise.all([
      crear(tokenAdminA, SLUG_A, {
        ...dtoProductoA,
        elementoId: productoA.id,
      }),
      crear(tokenAdminA, SLUG_A, {
        ...dtoProductoA,
        elementoId: productoA.id,
      }),
    ]);

    expect([primera.status, segunda.status].sort()).toEqual([201, 409]);

    const total = await prisma.descuento.count({
      where: { negocioId: negocioA.id, productoId: productoA.id },
    });
    expect(total).toBe(1);
  });

  it('HE-10-HU-02-CA-06: no existe endpoint de cancelación que escriba', async () => {
    const respuesta = await request(app.getHttpServer())
      .delete(`/descuentos/${productoA.id}`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(respuesta.status).toBe(404);

    const total = await prisma.descuento.count({
      where: { negocioId: negocioA.id },
    });
    expect(total).toBe(0);
  });

  it('HE-10-HU-02-CA-07: el descuento nace inactivo en respuesta y en base de datos', async () => {
    const respuesta = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
    });

    expect(respuesta.status).toBe(201);
    expect(cuerpo<DescuentoCreado>(respuesta).descuento.activo).toBe(false);

    const fila = await prisma.descuento.findFirst({
      where: { negocioId: negocioA.id, productoId: productoA.id },
    });
    expect(fila?.activo).toBe(false);
  });

  it('HE-10-HU-02-CA-08: acepta dos decimales y rechaza un tercero sin redondear', async () => {
    const valido = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
      porcentaje: 10.25,
    });
    expect(valido.status).toBe(201);
    expect(cuerpo<DescuentoCreado>(valido).descuento.porcentaje).toBe(10.25);

    const invalido = await crear(tokenAdminA, SLUG_A, {
      tipo: TipoDescuento.SERVICIO,
      elementoId: servicioA.id,
      porcentaje: 10.251,
      diasSemana: [WeekDay.MONDAY],
    });
    expect(invalido.status).toBe(400);

    const noNumerico = await crear(tokenAdminA, SLUG_A, {
      tipo: TipoDescuento.SERVICIO,
      elementoId: servicioA.id,
      porcentaje: 'abc',
      diasSemana: [WeekDay.MONDAY],
    });
    expect(noNumerico.status).toBe(400);
  });

  it('HE-10-HU-02-CA-01: un producto o servicio de otro negocio responde 404', async () => {
    const productoAjeno = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoB.id,
    });
    expect(productoAjeno.status).toBe(404);

    const servicioAjeno = await crear(tokenAdminA, SLUG_A, {
      tipo: TipoDescuento.SERVICIO,
      elementoId: servicioB.id,
      porcentaje: 10,
      diasSemana: [WeekDay.MONDAY],
    });
    expect(servicioAjeno.status).toBe(404);

    const inexistente = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: 999999,
    });
    expect(inexistente.status).toBe(404);
  });

  it('HE-10-HU-02-CA-01: cada negocio crea su propio descuento sin colisión', async () => {
    const enA = await crear(tokenAdminA, SLUG_A, {
      ...dtoProductoA,
      elementoId: productoA.id,
    });
    expect(enA.status).toBe(201);

    const enB = await crear(tokenAdminB, SLUG_B, {
      ...dtoProductoA,
      elementoId: productoB.id,
    });
    expect(enB.status).toBe(201);

    const totalA = await prisma.descuento.count({
      where: { negocioId: negocioA.id },
    });
    const totalB = await prisma.descuento.count({
      where: { negocioId: negocioB.id },
    });
    expect(totalA).toBe(1);
    expect(totalB).toBe(1);
  });
});

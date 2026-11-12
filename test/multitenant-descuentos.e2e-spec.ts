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

interface ListaDescuentosCuerpo {
  mensaje: string;
  descuentos: Array<{
    id: number;
    tipo: TipoDescuento;
    elemento: { id: number; nombre: string };
    porcentaje: number;
    diasSemana: WeekDay[];
    activo: boolean;
    creadoEn?: string;
    actualizadoEn?: string;
  }>;
  total: number;
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

// ---------------------------------------------------------------------------
// HE-10-HU-03 — Modificar descuento existente (MySQL 8.0 real)
// ---------------------------------------------------------------------------
describe('Descuentos: modificar descuento existente (HE-10-HU-03 — MySQL 8.0 real)', () => {
  let conexion: MariaDbConnection | undefined;
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let negocioA: { id: number; slug: string };
  let negocioB: { id: number; slug: string };
  let productoA: { id: number; nombre: string };
  let productoB: { id: number; nombre: string };
  let servicioA: { id: number; nombre: string };

  let tokenAdminA: string | undefined;
  let tokenAdminB: string | undefined;
  let tokenSuperadminA: string | undefined;
  let tokenBarberoA: string | undefined;

  const SLUG_HU03_A = 'hu03-negocio-a';
  const SLUG_HU03_B = 'hu03-negocio-b';
  const SECRETO_HU03 = 'secreto-hu03-descuentos';

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
        'La suite HE-10-HU-03 exige Docker/MariaDB. ' +
          'MARIADB_TEST_SKIP=1 no está permitido. Ver AGENTS.md §12.1.',
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
    process.env.JWT_SECRET = SECRETO_HU03;
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
      where: { slug: SLUG_HU03_A },
      update: {},
      create: { slug: SLUG_HU03_A, nombre: 'HU03 Negocio A' },
    });
    negocioB = await prisma.negocio.upsert({
      where: { slug: SLUG_HU03_B },
      update: {},
      create: { slug: SLUG_HU03_B, nombre: 'HU03 Negocio B' },
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

    const adminA = await crearUsuario('hu03-admin-a@test.local');
    const adminB = await crearUsuario('hu03-admin-b@test.local');
    const superadminA = await crearUsuario('hu03-superadmin-a@test.local');
    const barberoA = await crearUsuario('hu03-barbero-a@test.local');

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
        telefono: '3111111111',
        porcentajeComision: 50,
      },
    });

    tokenAdminA = await loginHu03('hu03-admin-a@test.local', SLUG_HU03_A);
    tokenAdminB = await loginHu03('hu03-admin-b@test.local', SLUG_HU03_B);
    tokenSuperadminA = await loginHu03(
      'hu03-superadmin-a@test.local',
      SLUG_HU03_A,
    );
    tokenBarberoA = await loginHu03('hu03-barbero-a@test.local', SLUG_HU03_A);
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
      data: { negocioId: negocioA.id, nombre: 'Prod HU03 A', precio: 20000 },
    });
    productoB = await prisma.producto.create({
      data: { negocioId: negocioB.id, nombre: 'Prod HU03 B', precio: 20000 },
    });
    servicioA = await prisma.servicio.create({
      data: {
        negocioId: negocioA.id,
        nombre: 'Serv HU03 A',
        precio: 15000,
        duracionMinutos: 30,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();
  });

  const loginHu03 = async (
    email: string,
    slug: string,
  ): Promise<string | undefined> => {
    const respuesta = await request(app.getHttpServer())
      .post('/auth/google')
      .set('X-Negocio-Slug', slug)
      .send({ idToken: email });

    return cuerpo<SesionEmitida>(respuesta).accessToken;
  };

  /** Crea un descuento directamente vía API. */
  const crearDescuento = (
    token: string | undefined,
    slug: string,
    campos: Record<string, unknown>,
  ) => {
    let peticion = request(app.getHttpServer())
      .post('/descuentos')
      .set('X-Negocio-Slug', slug);

    if (token) peticion = peticion.set('Authorization', `Bearer ${token}`);
    return peticion.send(campos);
  };

  /** GET /descuentos/:id */
  const consultar = (token: string | undefined, slug: string, id: number) => {
    let peticion = request(app.getHttpServer())
      .get(`/descuentos/${id}`)
      .set('X-Negocio-Slug', slug);

    if (token) peticion = peticion.set('Authorization', `Bearer ${token}`);
    return peticion.send();
  };

  /** PATCH /descuentos/:id */
  const modificar = (
    token: string | undefined,
    slug: string,
    id: number,
    cuerpoReq: Record<string, unknown>,
  ) => {
    let peticion = request(app.getHttpServer())
      .patch(`/descuentos/${id}`)
      .set('X-Negocio-Slug', slug);

    if (token) peticion = peticion.set('Authorization', `Bearer ${token}`);
    return peticion.send(cuerpoReq);
  };

  /** PATCH /descuentos/:id/estado */
  const cambiarEstado = (
    token: string | undefined,
    slug: string,
    id: number,
    cuerpoReq: Record<string, unknown>,
  ) => {
    let peticion = request(app.getHttpServer())
      .patch(`/descuentos/${id}/estado`)
      .set('X-Negocio-Slug', slug);

    if (token) peticion = peticion.set('Authorization', `Bearer ${token}`);
    return peticion.send(cuerpoReq);
  };

  /** GET /descuentos */
  const listarDescuentos = (token: string | undefined, slug: string) => {
    let peticion = request(app.getHttpServer())
      .get('/descuentos')
      .set('X-Negocio-Slug', slug);

    if (token) peticion = peticion.set('Authorization', `Bearer ${token}`);
    return peticion.send();
  };

  // -------------------------------------------------------------------------
  // HE-10-HU-03-CA-01 — Carga de configuración
  // -------------------------------------------------------------------------
  it(
    'HE-10-HU-03-CA-01: GET devuelve porcentaje, días, estado y elemento; ' +
      '403 para barbero; 404 para token de otro tenant; 404 para id inexistente',
    async () => {
      const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: productoA.id,
        porcentaje: 15,
        diasSemana: [WeekDay.MONDAY, WeekDay.WEDNESDAY],
      });
      expect(creado.status).toBe(201);
      const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

      // ADMINISTRADOR puede consultar
      const adminResp = await consultar(tokenAdminA, SLUG_HU03_A, id);
      expect(adminResp.status).toBe(200);
      const data = adminResp.body.descuento ?? adminResp.body;
      expect(data.porcentaje).toBe(15);
      expect(data.diasSemana).toEqual(
        expect.arrayContaining([WeekDay.MONDAY, WeekDay.WEDNESDAY]),
      );
      expect(data.activo).toBe(false);
      expect(data.elemento).toBeDefined();
      expect(data.elemento.id).toBe(productoA.id);

      // SUPERADMIN también puede consultar
      const superResp = await consultar(tokenSuperadminA, SLUG_HU03_A, id);
      expect(superResp.status).toBe(200);

      // BARBERO no puede consultar
      const barberoResp = await consultar(tokenBarberoA, SLUG_HU03_A, id);
      expect(barberoResp.status).toBe(403);

      // Admin del otro tenant recibe 404 (no revela datos ajenos)
      const ajenoResp = await consultar(tokenAdminB, SLUG_HU03_B, id);
      expect(ajenoResp.status).toBe(404);

      // ID inexistente
      const noExiste = await consultar(tokenAdminA, SLUG_HU03_A, 999999);
      expect(noExiste.status).toBe(404);
    },
  );

  // -------------------------------------------------------------------------
  // HE-10-HU-03-CA-02 — Modificación válida
  // -------------------------------------------------------------------------
  it(
    'HE-10-HU-03-CA-02: PATCH actualiza solo porcentaje; conserva ID y elemento; ' +
      'no crea registro nuevo',
    async () => {
      const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: productoA.id,
        porcentaje: 10,
        diasSemana: [WeekDay.MONDAY],
      });
      expect(creado.status).toBe(201);
      const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

      const resp = await modificar(tokenAdminA, SLUG_HU03_A, id, {
        porcentaje: 25.5,
      });
      expect(resp.status).toBe(200);

      const body = resp.body.descuento ?? resp.body;
      expect(body.id).toBe(id);
      expect(body.porcentaje).toBe(25.5);
      expect(body.elemento.id).toBe(productoA.id);

      // Solo existe un registro en BD
      const total = await prisma.descuento.count({
        where: { negocioId: negocioA.id, productoId: productoA.id },
      });
      expect(total).toBe(1);
    },
  );

  it(
    'HE-10-HU-03-CA-02: PATCH actualiza solo diasSemana; normaliza duplicados ' +
      'y orden canónico',
    async () => {
      const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: productoA.id,
        porcentaje: 10,
        diasSemana: [WeekDay.MONDAY],
      });
      expect(creado.status).toBe(201);
      const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

      const resp = await modificar(tokenAdminA, SLUG_HU03_A, id, {
        diasSemana: [WeekDay.FRIDAY, WeekDay.MONDAY, WeekDay.FRIDAY],
      });
      expect(resp.status).toBe(200);

      const dias: WeekDay[] = (resp.body.descuento ?? resp.body).diasSemana;
      // Sin duplicados
      const sinDuplicados = [...new Set(dias)];
      expect(dias.length).toBe(sinDuplicados.length);
      // Ambos días presentes
      expect(dias).toContain(WeekDay.MONDAY);
      expect(dias).toContain(WeekDay.FRIDAY);
    },
  );

  it(
    'HE-10-HU-03-CA-02: SUPERADMIN puede modificar; BARBERO recibe 403; ' +
      'Admin de otro tenant recibe 404',
    async () => {
      const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: productoA.id,
        porcentaje: 10,
        diasSemana: [WeekDay.TUESDAY],
      });
      expect(creado.status).toBe(201);
      const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

      // Tenant B tiene su propio producto y descuento
      const creadoB = await crearDescuento(tokenAdminB, SLUG_HU03_B, {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: productoB.id,
        porcentaje: 20,
        diasSemana: [WeekDay.THURSDAY],
      });
      expect(creadoB.status).toBe(201);

      // SUPERADMIN puede modificar
      const superResp = await modificar(tokenSuperadminA, SLUG_HU03_A, id, {
        porcentaje: 20,
      });
      expect(superResp.status).toBe(200);

      // BARBERO no puede
      const barberoResp = await modificar(tokenBarberoA, SLUG_HU03_A, id, {
        porcentaje: 30,
      });
      expect(barberoResp.status).toBe(403);

      // Admin de otro tenant no puede (acceso cruzado → 404)
      const ajenoResp = await modificar(tokenAdminB, SLUG_HU03_B, id, {
        porcentaje: 30,
      });
      expect(ajenoResp.status).toBe(404);
    },
  );

  // -------------------------------------------------------------------------
  // HE-10-HU-03-CA-03 — Validación durante modificación
  // -------------------------------------------------------------------------
  it(
    'HE-10-HU-03-CA-03: PATCH con porcentaje de más de dos decimales devuelve 400 ' +
      'y no altera la BD',
    async () => {
      const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: productoA.id,
        porcentaje: 10,
        diasSemana: [WeekDay.MONDAY],
      });
      expect(creado.status).toBe(201);
      const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

      const resp = await modificar(tokenAdminA, SLUG_HU03_A, id, {
        porcentaje: 10.251,
      });
      expect(resp.status).toBe(400);

      // BD sin cambios
      const fila = await prisma.descuento.findUnique({ where: { id } });
      expect(Number(fila?.porcentaje)).toBeCloseTo(10, 5);
    },
  );

  it('HE-10-HU-03-CA-03: PATCH con diasSemana vacío devuelve 400 y no altera la BD', async () => {
    const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoA.id,
      porcentaje: 10,
      diasSemana: [WeekDay.MONDAY],
    });
    expect(creado.status).toBe(201);
    const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

    const resp = await modificar(tokenAdminA, SLUG_HU03_A, id, {
      diasSemana: [],
    });
    expect(resp.status).toBe(400);

    const fila = await prisma.descuento.findUnique({ where: { id } });
    expect(fila).not.toBeNull();
    expect(Number(fila?.porcentaje)).toBeCloseTo(10, 5);
  });

  it('HE-10-HU-03-CA-03: PATCH sin ningún campo devuelve 400', async () => {
    const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoA.id,
      porcentaje: 10,
      diasSemana: [WeekDay.MONDAY],
    });
    expect(creado.status).toBe(201);
    const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

    const resp = await modificar(tokenAdminA, SLUG_HU03_A, id, {});
    expect(resp.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // HE-10-HU-03-CA-04 — Cancelación sin escritura
  // -------------------------------------------------------------------------
  it(
    'HE-10-HU-03-CA-04: no existe endpoint de cancelación; DELETE devuelve 404 ' +
      'y no deja persistencia',
    async () => {
      const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: productoA.id,
        porcentaje: 10,
        diasSemana: [WeekDay.MONDAY],
      });
      expect(creado.status).toBe(201);
      const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

      const deleteResp = await request(app.getHttpServer())
        .delete(`/descuentos/${id}/cancelar`)
        .set('X-Negocio-Slug', SLUG_HU03_A)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(deleteResp.status).toBe(404);

      // El registro original sigue intacto
      const fila = await prisma.descuento.findUnique({ where: { id } });
      expect(fila).not.toBeNull();
    },
  );

  // -------------------------------------------------------------------------
  // HE-10-HU-03-CA-05 — Conservación histórica de reservas
  // -------------------------------------------------------------------------
  it(
    'HE-10-HU-03-CA-05: modificar porcentaje/días no altera el descuento guardado ' +
      'en reservas confirmadas existentes',
    async () => {
      // Crear descuento
      const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
        tipo: TipoDescuento.SERVICIO,
        elementoId: servicioA.id,
        porcentaje: 20,
        diasSemana: [WeekDay.WEDNESDAY],
      });
      expect(creado.status).toBe(201);
      const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

      // Verificar recuento de reservas antes (0 — no hay reservas en esta suite)
      const reservasAntes = await prisma.reservation.count({
        where: { servicioId: servicioA.id },
      });

      // Modificar el descuento
      const patchResp = await modificar(tokenAdminA, SLUG_HU03_A, id, {
        porcentaje: 50,
      });
      expect(patchResp.status).toBe(200);

      // Recuento de reservas no debe cambiar
      const reservasDespues = await prisma.reservation.count({
        where: { servicioId: servicioA.id },
      });
      expect(reservasDespues).toBe(reservasAntes);

      // El registro de descuento sí se actualizó (sigue siendo uno)
      const total = await prisma.descuento.count({
        where: { negocioId: negocioA.id },
      });
      expect(total).toBe(1);

      // El porcentaje nuevo está en BD
      const fila = await prisma.descuento.findUnique({ where: { id } });
      expect(Number(fila?.porcentaje)).toBeCloseTo(50, 5);
    },
  );

  // -------------------------------------------------------------------------
  // HE-10-HU-04 — Activar o desactivar descuento
  // -------------------------------------------------------------------------
  it('HE-10-HU-04-CA-01: desactiva un descuento activo conservando porcentaje, días y elemento', async () => {
    const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoA.id,
      porcentaje: 25,
      diasSemana: [WeekDay.MONDAY, WeekDay.FRIDAY],
    });
    expect(creado.status).toBe(201);
    const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

    // Primero activarlo
    const activaResp = await cambiarEstado(tokenAdminA, SLUG_HU03_A, id, {
      activo: true,
    });
    expect(activaResp.status).toBe(200);
    expect(activaResp.body.descuento.activo).toBe(true);

    // Luego desactivarlo
    const desactivaResp = await cambiarEstado(tokenAdminA, SLUG_HU03_A, id, {
      activo: false,
    });
    expect(desactivaResp.status).toBe(200);
    expect(desactivaResp.body.mensaje).toBe(
      'Descuento desactivado correctamente',
    );
    expect(desactivaResp.body.descuento.activo).toBe(false);
    expect(desactivaResp.body.descuento.porcentaje).toBe(25);
    expect(desactivaResp.body.descuento.diasSemana).toEqual(
      expect.arrayContaining([WeekDay.MONDAY, WeekDay.FRIDAY]),
    );

    // En base de datos se conserva todo
    const enDb = await prisma.descuento.findUnique({ where: { id } });
    expect(enDb?.activo).toBe(false);
    expect(Number(enDb?.porcentaje)).toBeCloseTo(25, 5);
    expect(enDb?.productoId).toBe(productoA.id);
  });

  it('HE-10-HU-04-CA-02: activa un descuento inactivo con configuración válida', async () => {
    const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoA.id,
      porcentaje: 15,
      diasSemana: [WeekDay.TUESDAY],
    });
    expect(creado.status).toBe(201);
    const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

    const resp = await cambiarEstado(tokenAdminA, SLUG_HU03_A, id, {
      activo: true,
    });
    expect(resp.status).toBe(200);
    expect(resp.body.mensaje).toBe('Descuento activado correctamente');
    expect(resp.body.descuento.activo).toBe(true);
    expect(resp.body.descuento.porcentaje).toBe(15);
  });

  it('HE-10-HU-04-CA-02: rechaza activar un descuento con configuración inválida', async () => {
    const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoA.id,
      porcentaje: 15,
      diasSemana: [WeekDay.TUESDAY],
    });
    expect(creado.status).toBe(201);
    const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

    // Manipular BD para simular configuración corrupta/inválida
    await prisma.descuento.update({
      where: { id },
      data: { porcentaje: 0 },
    });

    const resp = await cambiarEstado(tokenAdminA, SLUG_HU03_A, id, {
      activo: true,
    });
    expect(resp.status).toBe(400);

    // Sigue inactivo en BD
    const enDb = await prisma.descuento.findUnique({ where: { id } });
    expect(enDb?.activo).toBe(false);
  });

  it('HE-10-HU-04-CA-03: confirma el estado y es idempotente ante reintentos', async () => {
    const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoA.id,
      porcentaje: 20,
      diasSemana: [WeekDay.WEDNESDAY],
    });
    expect(creado.status).toBe(201);
    const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

    // Nace inactivo; enviar false de nuevo responde 200 sin error
    const reintentoInactivo = await cambiarEstado(
      tokenAdminA,
      SLUG_HU03_A,
      id,
      {
        activo: false,
      },
    );
    expect(reintentoInactivo.status).toBe(200);
    expect(reintentoInactivo.body.descuento.activo).toBe(false);

    // Activar
    const activa = await cambiarEstado(tokenAdminA, SLUG_HU03_A, id, {
      activo: true,
    });
    expect(activa.status).toBe(200);
    expect(activa.body.descuento.activo).toBe(true);

    // Reintento de activar cuando ya está activo responde 200
    const reintentoActivo = await cambiarEstado(tokenAdminA, SLUG_HU03_A, id, {
      activo: true,
    });
    expect(reintentoActivo.status).toBe(200);
    expect(reintentoActivo.body.descuento.activo).toBe(true);
  });

  it('HE-10-HU-04-CA-04: ADMINISTRADOR y SUPERADMIN activan/desactivan; BARBERO recibe 403; tenant ajeno 404', async () => {
    const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoA.id,
      porcentaje: 30,
      diasSemana: [WeekDay.THURSDAY],
    });
    expect(creado.status).toBe(201);
    const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

    // SUPERADMIN puede activar y desactivar (decisión de usuario)
    const superActiva = await cambiarEstado(tokenSuperadminA, SLUG_HU03_A, id, {
      activo: true,
    });
    expect(superActiva.status).toBe(200);
    expect(superActiva.body.descuento.activo).toBe(true);

    const superDesactiva = await cambiarEstado(
      tokenSuperadminA,
      SLUG_HU03_A,
      id,
      {
        activo: false,
      },
    );
    expect(superDesactiva.status).toBe(200);
    expect(superDesactiva.body.descuento.activo).toBe(false);

    // BARBERO recibe 403
    const barberoActiva = await cambiarEstado(tokenBarberoA, SLUG_HU03_A, id, {
      activo: true,
    });
    expect(barberoActiva.status).toBe(403);

    // Token de otro tenant recibe 404 (aislamiento)
    const ajenoResp = await cambiarEstado(tokenAdminB, SLUG_HU03_B, id, {
      activo: true,
    });
    expect(ajenoResp.status).toBe(404);
  });

  it('HE-10-HU-04-CA-04: desactivar un descuento NO habilita crear un segundo descuento para el mismo elemento', async () => {
    const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoA.id,
      porcentaje: 10,
      diasSemana: [WeekDay.MONDAY],
    });
    expect(creado.status).toBe(201);
    const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

    // Desactivar explícitamente (o confirmar que está inactivo)
    await cambiarEstado(tokenAdminA, SLUG_HU03_A, id, { activo: false });

    // Intentar crear otro descuento para el mismo productoA mientras está inactivo
    const segundo = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: productoA.id,
      porcentaje: 20,
      diasSemana: [WeekDay.FRIDAY],
    });
    expect(segundo.status).toBe(409);

    const total = await prisma.descuento.count({
      where: { negocioId: negocioA.id, productoId: productoA.id },
    });
    expect(total).toBe(1);
  });

  it('HE-10-HU-04-CA-04: desactivar un descuento no altera reservas confirmadas preexistentes', async () => {
    const creado = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
      tipo: TipoDescuento.SERVICIO,
      elementoId: servicioA.id,
      porcentaje: 20,
      diasSemana: [WeekDay.FRIDAY],
    });
    expect(creado.status).toBe(201);
    const id: number = cuerpo<DescuentoCreado>(creado).descuento.id;

    // Activar primero
    await cambiarEstado(tokenAdminA, SLUG_HU03_A, id, { activo: true });

    const reservasAntes = await prisma.reservation.count({
      where: { servicioId: servicioA.id },
    });

    // Desactivar
    const resp = await cambiarEstado(tokenAdminA, SLUG_HU03_A, id, {
      activo: false,
    });
    expect(resp.status).toBe(200);

    const reservasDespues = await prisma.reservation.count({
      where: { servicioId: servicioA.id },
    });
    expect(reservasDespues).toBe(reservasAntes);
  });

  // -------------------------------------------------------------------------
  // HE-10-HU-01 � Consultar los descuentos configurados
  // -------------------------------------------------------------------------
  describe('HE-10-HU-01 � Consultar los descuentos configurados', () => {
    it('HE-10-HU-01-CA-01 / CA-02: lista descuentos con tipo, porcentaje, d�as, estado y elemento', async () => {
      // Crear descuento producto
      const creadoProd = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: productoA.id,
        porcentaje: 10,
        diasSemana: [WeekDay.MONDAY, WeekDay.FRIDAY],
      });
      expect(creadoProd.status).toBe(201);

      // Crear descuento servicio
      const creadoServ = await crearDescuento(tokenAdminA, SLUG_HU03_A, {
        tipo: TipoDescuento.SERVICIO,
        elementoId: servicioA.id,
        porcentaje: 25,
        diasSemana: [WeekDay.TUESDAY, WeekDay.SATURDAY],
      });
      expect(creadoServ.status).toBe(201);

      // Consultar listado
      const resp = await listarDescuentos(tokenAdminA, SLUG_HU03_A);
      expect(resp.status).toBe(200);

      const datos = cuerpo<ListaDescuentosCuerpo>(resp);
      expect(datos.mensaje).toBe('Descuentos consultados correctamente');
      expect(datos.total).toBe(2);
      expect(datos.descuentos).toHaveLength(2);

      // CA-02: Diferenciaci�n del elemento
      const descProd = datos.descuentos.find(
        (d) => d.tipo === TipoDescuento.PRODUCTO,
      );
      expect(descProd).toBeDefined();
      expect(descProd?.elemento.id).toBe(productoA.id);
      expect(descProd?.elemento.nombre).toBe(productoA.nombre);
      expect(descProd?.porcentaje).toBe(10);
      expect(descProd?.activo).toBe(false);

      const descServ = datos.descuentos.find(
        (d) => d.tipo === TipoDescuento.SERVICIO,
      );
      expect(descServ).toBeDefined();
      expect(descServ?.elemento.id).toBe(servicioA.id);
      expect(descServ?.elemento.nombre).toBe(servicioA.nombre);
      expect(descServ?.porcentaje).toBe(25);
    });

    it('HE-10-HU-01-CA-03: listado vac�o responde 200 con array vac�o y mensaje descriptivo', async () => {
      const resp = await listarDescuentos(tokenAdminA, SLUG_HU03_A);
      expect(resp.status).toBe(200);

      const datos = cuerpo<ListaDescuentosCuerpo>(resp);
      expect(datos.total).toBe(0);
      expect(datos.descuentos).toEqual([]);
      expect(datos.mensaje).toBe(
        'No hay descuentos configurados para este negocio',
      );
    });

    it('HE-10-HU-01-CA-04: control de acceso y aislamiento multitenant estricto', async () => {
      // Crear descuento en negocio A
      await crearDescuento(tokenAdminA, SLUG_HU03_A, {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: productoA.id,
        porcentaje: 15,
        diasSemana: [WeekDay.WEDNESDAY],
      });

      // 401 sin autenticaci�n
      const sinToken = await listarDescuentos(undefined, SLUG_HU03_A);
      expect(sinToken.status).toBe(401);

      // 403 para barbero
      const barberoResp = await listarDescuentos(tokenBarberoA, SLUG_HU03_A);
      expect(barberoResp.status).toBe(403);

      // Aislamiento: Admin de negocio B no ve los descuentos de negocio A
      const respB = await listarDescuentos(tokenAdminB, SLUG_HU03_B);
      expect(respB.status).toBe(200);
      const datosB = cuerpo<ListaDescuentosCuerpo>(respB);
      expect(datosB.total).toBe(0);
      expect(datosB.descuentos).toEqual([]);

      // SUPERADMIN de negocio A puede consultar
      const superadminResp = await listarDescuentos(
        tokenSuperadminA,
        SLUG_HU03_A,
      );
      expect(superadminResp.status).toBe(200);
      const datosSuper = cuerpo<ListaDescuentosCuerpo>(superadminResp);
      expect(datosSuper.total).toBe(1);
    });
  });
});

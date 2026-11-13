/**
 * INVARIANTE DE COHERENCIA DE PRECIOS — HE-10 / H1
 *
 * Verifica que el `precioFinal` devuelto por:
 *   - GET /descuentos/aplicable/servicio/:id?fecha=<X>
 *   - POST /descuentos/aplicables   { servicioIds: [id], fecha: X }
 *   - POST /reservas                { ... fecha: X }   → precioReservado
 *
 * sea idéntico cuando el descuento aplica.
 *
 * También verifica la cascada soft P2:
 *   PATCH /productos/:id/estado { estado: INACTIVO } → descuento queda activo=false.
 *
 * Requisitos: Docker disponible (MariaDB/MySQL). Se omite si MARIADB_TEST_SKIP=1.
 */

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
import { ReservasModule } from '../src/modules/reservas/reservas.module';
import { ProductosModule } from '../src/modules/productos/productos.module';
import { ConfiguracionModule } from '../src/modules/configuracion/configuracion.module';
import { ServiciosModule } from '../src/modules/servicios/servicios.module';
import { UsuariosModule } from '../src/modules/usuarios/usuarios.module';
import { HorariosModule } from '../src/modules/horarios/horarios.module';
import { ClientesAuthModule } from '../src/auth/clientes/clientes-auth.module';
import { WhatsAppModule } from '../src/modules/whatsapp/whatsapp.module';

const SECRETO = 'secreto-coherencia-descuentos-e2e';
const SLUG = 'coherencia-descuentos-negocio';
const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

/** Días de semana en orden ISO (lunes=1). */
const WEEKDAY_ISO: Record<number, WeekDay> = {
  1: WeekDay.MONDAY,
  2: WeekDay.TUESDAY,
  3: WeekDay.WEDNESDAY,
  4: WeekDay.THURSDAY,
  5: WeekDay.FRIDAY,
  6: WeekDay.SATURDAY,
  0: WeekDay.SUNDAY,
};

/** Devuelve la fecha YYYY-MM-DD del próximo día de semana ISO dado (1=lunes). */
function proximoDiaSemana(isoDia: number): string {
  const hoy = new Date();
  const diaActual = hoy.getDay(); // 0=dom
  let diff = isoDia - diaActual;
  if (diff <= 0) diff += 7;
  const objetivo = new Date(hoy);
  objetivo.setDate(hoy.getDate() + diff);
  const yyyy = objetivo.getFullYear();
  const mm = String(objetivo.getMonth() + 1).padStart(2, '0');
  const dd = String(objetivo.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function cuerpo<T>(r: Response): T {
  return (r.body ?? {}) as T;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    NegociosModule,
    PrismaModule,
    ConfiguracionModule,
    ServiciosModule,
    UsuariosModule,
    HorariosModule,
    ReservasModule,
    DescuentosModule,
    ProductosModule,
    ClientesAuthModule,
    WhatsAppModule,
  ],
})
class PruebaCoherenciaModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Invariante de coherencia de precios — descuento + reserva (MariaDB real)', () => {
  let conexion: MariaDbConnection | undefined;
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let http: App;

  let negocioId: number;
  let tokenAdmin: string;

  let servicioId: number;
  let precioServicio: number;
  let barberoId: number;
  let productoId: number;
  let precioProducto: number;

  /** Fecha del próximo lunes (descuento configurado para LUNES y MARTES). */
  const fechaLunes = proximoDiaSemana(1);
  const diaSemanaLunes = WeekDay.MONDAY;

  const verificarGoogle = jest.fn((idToken: string) =>
    Promise.resolve({
      sub: `sub-${idToken}`,
      email: idToken,
      email_verified: true,
      given_name: 'Persona',
    }),
  );

  beforeAll(async () => {
    if (OMITIR_SIN_DOCKER) return;

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
    process.env.JWT_SECRET = SECRETO;
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
      imports: [PruebaCoherenciaModule],
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
    http = app.getHttpServer();

    // --- Siembra ---
    const negocio = await prisma.negocio.upsert({
      where: { slug: SLUG },
      update: {},
      create: { slug: SLUG, nombre: 'Coherencia Negocio' },
    });
    negocioId = negocio.id;

    const usuarioAdmin = await prisma.usuario.upsert({
      where: { email: 'coherencia-admin@test.local' },
      update: {},
      create: {
        email: 'coherencia-admin@test.local',
        nombre: 'Admin',
        apellido: 'Coherencia',
        rol: 'PERSONAL',
      },
    });

    // Asociar admin al negocio
    await prisma.administrador.upsert({
      where: {
        negocioId_usuarioId: {
          negocioId,
          usuarioId: usuarioAdmin.id,
        },
      },
      update: {},
      create: {
        usuarioId: usuarioAdmin.id,
        negocioId,
        superadmin: false,
      },
    });

    // Login del admin
    const loginAdmin = await request(http)
      .post('/auth/google')
      .set('x-negocio-slug', SLUG)
      .send({ idToken: 'coherencia-admin@test.local' });
    tokenAdmin =
      (loginAdmin.body as { accessToken?: string }).accessToken ?? '';

    // Crear servicio en BD (precio 50000)
    precioServicio = 50000;
    const serv = await prisma.servicio.create({
      data: {
        negocioId,
        nombre: `Corte Coherencia ${Date.now()}`,
        precio: precioServicio,
        duracionMinutos: 30,
      },
    });
    servicioId = serv.id;

    // Crear producto en BD (precio 30000)
    precioProducto = 30000;
    const prod = await prisma.producto.create({
      data: {
        negocioId,
        nombre: `Cera Coherencia ${Date.now()}`,
        precio: precioProducto,
      },
    });
    productoId = prod.id;

    // Crear barbero y horario para poder crear reservas
    const usuarioBarbero = await prisma.usuario.upsert({
      where: { email: 'coherencia-barbero@test.local' },
      update: {},
      create: {
        email: 'coherencia-barbero@test.local',
        nombre: 'Barbero',
        apellido: 'Coherencia',
        rol: 'PERSONAL',
      },
    });
    const barbero = await prisma.barbero.upsert({
      where: {
        negocioId_usuarioId: { negocioId, usuarioId: usuarioBarbero.id },
      },
      update: {},
      create: {
        usuarioId: usuarioBarbero.id,
        negocioId,
        telefono: '3001234567',
        porcentajeComision: 40,
      },
    });
    barberoId = barbero.id;

    // Asignar servicio al barbero
    await prisma.barberoServicio.upsert({
      where: {
        barberoId_servicioId: { barberoId, servicioId },
      },
      update: {},
      create: { barberoId, servicioId, negocioId },
    });

    // Crear slot semanal para el barbero (todos los días, 09:00–18:00)
    for (const [, dia] of Object.entries(WEEKDAY_ISO)) {
      const existing = await prisma.barberWeeklySlot.findFirst({
        where: { barberoId, dayOfWeek: dia },
      });
      if (!existing) {
        await prisma.barberWeeklySlot.create({
          data: {
            barberoId,
            negocioId,
            dayOfWeek: dia,
            startTime: '09:00',
            endTime: '18:00',
            active: true,
          },
        });
      }
    }
  }, 300000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();
  });

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  const crearDescuento = (
    tipo: TipoDescuento,
    elementoId: number,
    pct: number,
    dias: WeekDay[],
  ) =>
    request(http)
      .post('/descuentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('x-negocio-slug', SLUG)
      .send({ tipo, elementoId, porcentaje: pct, diasSemana: dias });

  const activarDescuento = (id: number) =>
    request(http)
      .patch(`/descuentos/${id}/estado`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('x-negocio-slug', SLUG)
      .send({ activo: true });

  const evaluarServicio = (sId: number, fecha: string) =>
    request(http)
      .get(`/descuentos/aplicable/servicio/${sId}`)
      .set('x-negocio-slug', SLUG)
      .query({ fecha });

  const evaluarProducto = (pId: number) =>
    request(http)
      .get(`/descuentos/aplicable/producto/${pId}`)
      .set('x-negocio-slug', SLUG);

  const evaluarBatch = (servicioIds: number[], fecha: string) =>
    request(http)
      .post('/descuentos/aplicables')
      .set('x-negocio-slug', SLUG)
      .send({ servicioIds, fecha });

  const evaluarBatchProductos = (productoIds: number[]) =>
    request(http)
      .post('/descuentos/aplicables')
      .set('x-negocio-slug', SLUG)
      .send({ productoIds });

  const obtenerProductoCatalogo = (pId: number) =>
    request(http).get(`/productos/catalogo/${pId}`).set('x-negocio-slug', SLUG);

  const listarProductosCatalogo = () =>
    request(http).get('/productos/catalogo').set('x-negocio-slug', SLUG);

  const crearReservaInvitado = (
    sId: number,
    bId: number,
    fecha: string,
    hora = '09:00',
  ) =>
    request(http).post('/reservas').set('x-negocio-slug', SLUG).send({
      servicioId: sId,
      barberoId: bId,
      fecha,
      hora,
      nombre: 'Cliente Test',
      telefono: '3009999999',
    });

  const desactivarProducto = (pId: number) =>
    request(http)
      .patch(`/productos/${pId}/estado`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('x-negocio-slug', SLUG)
      .send({ estado: 'INACTIVO' });

  // ---------------------------------------------------------------------------
  // TEST 1: INVARIANTE PRINCIPAL — mismo precioFinal en los 3 endpoints
  // ---------------------------------------------------------------------------

  it('COHERENCIA-01: GET /descuentos/aplicable/servicio, POST /descuentos/aplicables y POST /reservas devuelven el mismo precioFinal', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const porcentaje = 20; // 50000 * 0.80 = 40000
    const precioEsperado =
      Math.round(precioServicio * (1 - porcentaje / 100) * 100) / 100;

    // Crear y activar descuento de servicio para lunes y martes
    const creado = await crearDescuento(
      TipoDescuento.SERVICIO,
      servicioId,
      porcentaje,
      [WeekDay.MONDAY, WeekDay.TUESDAY],
    );
    expect(creado.status).toBe(201);
    const descuentoId: number = (creado.body as { descuento: { id: number } })
      .descuento.id;
    const activado = await activarDescuento(descuentoId);
    expect(activado.status).toBe(200);

    // 1. GET /descuentos/aplicable/servicio/:id?fecha=<lunes>
    const respEvaluar = await evaluarServicio(servicioId, fechaLunes);
    expect(respEvaluar.status).toBe(200);
    const datosEvaluar = cuerpo<{
      aplica: boolean;
      estado: string;
      precioFinal: number;
      porcentajeAplicado: number;
      diaEvaluado: WeekDay;
    }>(respEvaluar);

    expect(datosEvaluar.aplica).toBe(true);
    expect(datosEvaluar.estado).toBe('APLICADO');
    expect(datosEvaluar.diaEvaluado).toBe(diaSemanaLunes);
    expect(datosEvaluar.porcentajeAplicado).toBe(porcentaje);
    expect(datosEvaluar.precioFinal).toBe(precioEsperado);

    // 2. POST /descuentos/aplicables { servicioIds: [id], fecha }
    const respBatch = await evaluarBatch([servicioId], fechaLunes);
    expect(respBatch.status).toBe(200);
    const datosBatch = cuerpo<{
      servicios: Array<{
        precioFinal: number;
        aplica: boolean;
        estado: string;
      }>;
    }>(respBatch);
    expect(datosBatch.servicios).toHaveLength(1);
    expect(datosBatch.servicios[0].aplica).toBe(true);
    expect(datosBatch.servicios[0].estado).toBe('APLICADO');
    expect(datosBatch.servicios[0].precioFinal).toBe(precioEsperado);

    // 3. POST /reservas — precioReservado en base de datos debe coincidir
    const respReserva = await crearReservaInvitado(
      servicioId,
      barberoId,
      fechaLunes,
    );
    expect(respReserva.status).toBe(201);
    const reservaCreada = cuerpo<{ id: number }>(respReserva);
    const reservaDb = await prisma.reservation.findUnique({
      where: { id: reservaCreada.id },
    });
    expect(Number(reservaDb?.precioReservado)).toBe(precioEsperado);

    // --- INVARIANTE CENTRAL ---
    expect(datosEvaluar.precioFinal).toBe(datosBatch.servicios[0].precioFinal);
    expect(datosEvaluar.precioFinal).toBe(Number(reservaDb?.precioReservado));
  });

  // ---------------------------------------------------------------------------
  // TEST 2: Sin descuento activo, reserva usa precio original
  // ---------------------------------------------------------------------------

  it('COHERENCIA-02: sin descuento activo POST /reservas usa precioReservado = precioOriginal', async () => {
    if (OMITIR_SIN_DOCKER) return;

    // Crear un segundo servicio sin descuento en BD
    const serv2 = await prisma.servicio.create({
      data: {
        negocioId,
        nombre: `Servicio Sin Descuento ${Date.now()}`,
        precio: 35000,
        duracionMinutos: 30,
      },
    });
    const servicio2Id = serv2.id;

    // Asignar al barbero
    await prisma.barberoServicio.upsert({
      where: { barberoId_servicioId: { barberoId, servicioId: servicio2Id } },
      update: {},
      create: { barberoId, servicioId: servicio2Id, negocioId },
    });

    const fechaMartes = proximoDiaSemana(2);
    const respReserva = await crearReservaInvitado(
      servicio2Id,
      barberoId,
      fechaMartes,
      '09:00',
    );
    expect(respReserva.status).toBe(201);
    const reservaCreada = cuerpo<{ id: number }>(respReserva);
    const reservaDb = await prisma.reservation.findUnique({
      where: { id: reservaCreada.id },
    });
    expect(Number(reservaDb?.precioReservado)).toBe(35000);
  });

  // ---------------------------------------------------------------------------
  // TEST 3: Descuento no aplica ese día — reserva usa precio original
  // ---------------------------------------------------------------------------

  it('COHERENCIA-03: descuento activo pero no aplica el día de la reserva → precioReservado = precioOriginal', async () => {
    if (OMITIR_SIN_DOCKER) return;

    // Buscar el próximo miércoles (descuento configurado para lunes)
    const fechaMiercoles = proximoDiaSemana(3);

    // GET evaluarServicio en miércoles con descuento de lunes: NO_APLICA_DIA
    const respEvaluar = await evaluarServicio(servicioId, fechaMiercoles);
    expect(respEvaluar.status).toBe(200);
    const datosEvaluar = cuerpo<{
      aplica: boolean;
      estado: string;
      precioFinal: number;
    }>(respEvaluar);
    expect(datosEvaluar.aplica).toBe(false);
    expect(datosEvaluar.estado).toBe('NO_APLICA_DIA');
    expect(datosEvaluar.precioFinal).toBe(precioServicio);

    // POST /reservas en miércoles
    const respReserva = await crearReservaInvitado(
      servicioId,
      barberoId,
      fechaMiercoles,
    );
    expect(respReserva.status).toBe(201);
    const reservaCreada = cuerpo<{ id: number }>(respReserva);
    const reservaDb = await prisma.reservation.findUnique({
      where: { id: reservaCreada.id },
    });
    expect(Number(reservaDb?.precioReservado)).toBe(precioServicio);

    // Coherencia: mismo valor
    expect(datosEvaluar.precioFinal).toBe(Number(reservaDb?.precioReservado));
  });

  // ---------------------------------------------------------------------------
  // TEST 4: P2 — Cascada soft al desactivar producto
  // ---------------------------------------------------------------------------

  it('P2-E2E-01: al desactivar un producto su descuento queda activo=false (cascada soft)', async () => {
    if (OMITIR_SIN_DOCKER) return;

    // Crear y activar descuento del producto
    const creado = await crearDescuento(
      TipoDescuento.PRODUCTO,
      productoId,
      15,
      [WeekDay.MONDAY, WeekDay.WEDNESDAY, WeekDay.FRIDAY],
    );
    expect(creado.status).toBe(201);
    const descuentoId: number = (creado.body as { descuento: { id: number } })
      .descuento.id;
    await activarDescuento(descuentoId);

    // Verificar que el descuento está activo en BD
    const descuentoAntes = await prisma.descuento.findUnique({
      where: { id: descuentoId },
    });
    expect(descuentoAntes?.activo).toBe(true);

    // Desactivar el producto
    const respDesactivar = await desactivarProducto(productoId);
    expect(respDesactivar.status).toBe(200);

    // Dar tiempo a la cascada fire-and-forget (es async)
    await new Promise((r) => setTimeout(r, 300));

    // Verificar que el descuento quedó inactivo
    const descuentoDespues = await prisma.descuento.findUnique({
      where: { id: descuentoId },
    });
    expect(descuentoDespues?.activo).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // TEST 5: P2 — Reactivar producto NO reactiva el descuento
  // ---------------------------------------------------------------------------

  it('P2-E2E-02: reactivar el producto NO reactiva el descuento (cascada solo en desactivación)', async () => {
    if (OMITIR_SIN_DOCKER) return;

    // El producto está inactivo del test anterior; reactivarlo
    const respActivar = await request(http)
      .patch(`/productos/${productoId}/estado`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('x-negocio-slug', SLUG)
      .send({ estado: 'ACTIVO' });
    expect(respActivar.status).toBe(200);

    await new Promise((r) => setTimeout(r, 300));

    // El descuento sigue inactivo
    const descuento = await prisma.descuento.findFirst({
      where: {
        negocioId,
        tipo: TipoDescuento.PRODUCTO,
        productoId,
      },
    });
    expect(descuento?.activo).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // TEST 6: COHERENCIA-04 — Producto con descuento APLICADO en catálogo
  // ---------------------------------------------------------------------------

  it('COHERENCIA-04: producto con descuento APLICADO -> GET /productos/catalogo/:id devuelve precioFinal === GET /descuentos/aplicable/producto/:id.precioFinal', async () => {
    if (OMITIR_SIN_DOCKER) return;

    // Crear producto nuevo
    const prod = await prisma.producto.create({
      data: {
        negocioId,
        nombre: `Producto Con Descuento ${Date.now()}`,
        precio: 40000,
        estado: 'ACTIVO',
      },
    });

    const porcentaje = 25; // 40000 * 0.75 = 30000
    const precioEsperado = 30000;

    // Descuento configurado todos los días para que aplique hoy
    const creado = await crearDescuento(
      TipoDescuento.PRODUCTO,
      prod.id,
      porcentaje,
      [
        WeekDay.MONDAY,
        WeekDay.TUESDAY,
        WeekDay.WEDNESDAY,
        WeekDay.THURSDAY,
        WeekDay.FRIDAY,
        WeekDay.SATURDAY,
        WeekDay.SUNDAY,
      ],
    );
    expect(creado.status).toBe(201);
    const descuentoId: number = (creado.body as { descuento: { id: number } })
      .descuento.id;
    await activarDescuento(descuentoId);

    // 1. GET /descuentos/aplicable/producto/:id
    const respEvaluar = await evaluarProducto(prod.id);
    expect(respEvaluar.status).toBe(200);
    const datosEvaluar = cuerpo<{
      aplica: boolean;
      estado: string;
      precioOriginal: number;
      precioFinal: number;
    }>(respEvaluar);
    expect(datosEvaluar.aplica).toBe(true);
    expect(datosEvaluar.estado).toBe('APLICADO');
    expect(datosEvaluar.precioFinal).toBe(precioEsperado);

    // 2. GET /productos/catalogo/:id
    const respCatalogo = await obtenerProductoCatalogo(prod.id);
    expect(respCatalogo.status).toBe(200);
    const datosCatalogo = cuerpo<{
      id: number;
      precio: number;
      precioOriginal: number;
      precioFinal: number;
      descuentoAplicable: {
        estado: string;
        aplica: boolean;
        precioFinal: number;
      };
    }>(respCatalogo);

    expect(datosCatalogo.precioOriginal).toBe(40000);
    expect(datosCatalogo.precioFinal).toBe(precioEsperado);
    expect(datosCatalogo.descuentoAplicable?.estado).toBe('APLICADO');
    expect(datosCatalogo.descuentoAplicable?.aplica).toBe(true);

    // --- INVARIANTE COHERENCIA ---
    expect(datosCatalogo.precioFinal).toBe(datosEvaluar.precioFinal);
  });

  // ---------------------------------------------------------------------------
  // TEST 7: COHERENCIA-05 — Producto sin descuento
  // ---------------------------------------------------------------------------

  it('COHERENCIA-05: producto sin descuento -> precioFinal === precioOriginal y descuentoAplicable === null', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const prod = await prisma.producto.create({
      data: {
        negocioId,
        nombre: `Producto Sin Descuento ${Date.now()}`,
        precio: 25000,
        estado: 'ACTIVO',
      },
    });

    // 1. GET /descuentos/aplicable/producto/:id
    const respEvaluar = await evaluarProducto(prod.id);
    expect(respEvaluar.status).toBe(200);
    const datosEvaluar = cuerpo<{
      aplica: boolean;
      estado: string;
      precioFinal: number;
    }>(respEvaluar);
    expect(datosEvaluar.aplica).toBe(false);
    expect(datosEvaluar.estado).toBe('SIN_DESCUENTO');
    expect(datosEvaluar.precioFinal).toBe(25000);

    // 2. GET /productos/catalogo/:id
    const respCatalogo = await obtenerProductoCatalogo(prod.id);
    expect(respCatalogo.status).toBe(200);
    const datosCatalogo = cuerpo<{
      precioOriginal: number;
      precioFinal: number;
      descuentoAplicable: unknown;
    }>(respCatalogo);

    expect(datosCatalogo.precioOriginal).toBe(25000);
    expect(datosCatalogo.precioFinal).toBe(25000);
    expect(datosCatalogo.descuentoAplicable).toBeNull();

    // --- INVARIANTE COHERENCIA ---
    expect(datosCatalogo.precioFinal).toBe(datosEvaluar.precioFinal);
    expect(datosCatalogo.precioFinal).toBe(datosCatalogo.precioOriginal);
  });

  // ---------------------------------------------------------------------------
  // TEST 8: COHERENCIA-06 — Producto con descuento INACTIVO
  // ---------------------------------------------------------------------------

  it('COHERENCIA-06: producto con descuento INACTIVO -> estado: "INACTIVO", precioFinal === precioOriginal', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const prod = await prisma.producto.create({
      data: {
        negocioId,
        nombre: `Producto Descuento Inactivo ${Date.now()}`,
        precio: 60000,
        estado: 'ACTIVO',
      },
    });

    // Crear descuento inactivo
    const creado = await crearDescuento(TipoDescuento.PRODUCTO, prod.id, 50, [
      WeekDay.MONDAY,
      WeekDay.TUESDAY,
      WeekDay.WEDNESDAY,
      WeekDay.THURSDAY,
      WeekDay.FRIDAY,
      WeekDay.SATURDAY,
      WeekDay.SUNDAY,
    ]);
    expect(creado.status).toBe(201);
    // No se activa (queda activo=false)

    // 1. GET /descuentos/aplicable/producto/:id
    const respEvaluar = await evaluarProducto(prod.id);
    expect(respEvaluar.status).toBe(200);
    const datosEvaluar = cuerpo<{
      aplica: boolean;
      estado: string;
      precioFinal: number;
    }>(respEvaluar);
    expect(datosEvaluar.aplica).toBe(false);
    expect(datosEvaluar.estado).toBe('INACTIVO');
    expect(datosEvaluar.precioFinal).toBe(60000);

    // 2. GET /productos/catalogo/:id
    const respCatalogo = await obtenerProductoCatalogo(prod.id);
    expect(respCatalogo.status).toBe(200);
    const datosCatalogo = cuerpo<{
      precioOriginal: number;
      precioFinal: number;
      descuentoAplicable: {
        estado: string;
        aplica: boolean;
        precioFinal: number;
      };
    }>(respCatalogo);

    expect(datosCatalogo.precioOriginal).toBe(60000);
    expect(datosCatalogo.precioFinal).toBe(60000);
    expect(datosCatalogo.descuentoAplicable?.estado).toBe('INACTIVO');
    expect(datosCatalogo.descuentoAplicable?.aplica).toBe(false);

    // --- INVARIANTE COHERENCIA ---
    expect(datosCatalogo.precioFinal).toBe(datosEvaluar.precioFinal);
    expect(datosCatalogo.precioFinal).toBe(datosCatalogo.precioOriginal);
  });

  // ---------------------------------------------------------------------------
  // TEST 9: COHERENCIA-07 — Batch POST /descuentos/aplicables con 3 productos
  // ---------------------------------------------------------------------------

  it('COHERENCIA-07: batch POST /descuentos/aplicables con 3 productos devuelve mismo precioFinal y orden que individuales y catálogo', async () => {
    if (OMITIR_SIN_DOCKER) return;

    // 3 productos: P1 (con descuento 10%), P2 (sin descuento), P3 (descuento inactivo)
    const p1 = await prisma.producto.create({
      data: {
        negocioId,
        nombre: `Batch P1 ${Date.now()}`,
        precio: 10000,
        estado: 'ACTIVO',
      },
    });
    const d1 = await crearDescuento(TipoDescuento.PRODUCTO, p1.id, 10, [
      WeekDay.MONDAY,
      WeekDay.TUESDAY,
      WeekDay.WEDNESDAY,
      WeekDay.THURSDAY,
      WeekDay.FRIDAY,
      WeekDay.SATURDAY,
      WeekDay.SUNDAY,
    ]);
    await activarDescuento(
      (d1.body as { descuento: { id: number } }).descuento.id,
    );

    const p2 = await prisma.producto.create({
      data: {
        negocioId,
        nombre: `Batch P2 ${Date.now()}`,
        precio: 20000,
        estado: 'ACTIVO',
      },
    });

    const p3 = await prisma.producto.create({
      data: {
        negocioId,
        nombre: `Batch P3 ${Date.now()}`,
        precio: 30000,
        estado: 'ACTIVO',
      },
    });
    await crearDescuento(TipoDescuento.PRODUCTO, p3.id, 20, [
      WeekDay.MONDAY,
      WeekDay.TUESDAY,
      WeekDay.WEDNESDAY,
      WeekDay.THURSDAY,
      WeekDay.FRIDAY,
      WeekDay.SATURDAY,
      WeekDay.SUNDAY,
    ]); // Queda inactivo

    // 1. Batch evaluation
    const respBatch = await evaluarBatchProductos([p1.id, p2.id, p3.id]);
    expect(respBatch.status).toBe(200);
    const datosBatch = cuerpo<{
      productos: Array<{
        elementoId: number;
        estado: string;
        aplica: boolean;
        precioOriginal: number;
        precioFinal: number;
      }>;
    }>(respBatch);

    expect(datosBatch.productos).toHaveLength(3);
    // Alineación por índice
    expect(datosBatch.productos[0].elementoId).toBe(p1.id);
    expect(datosBatch.productos[0].estado).toBe('APLICADO');
    expect(datosBatch.productos[0].precioFinal).toBe(9000);

    expect(datosBatch.productos[1].elementoId).toBe(p2.id);
    expect(datosBatch.productos[1].estado).toBe('SIN_DESCUENTO');
    expect(datosBatch.productos[1].precioFinal).toBe(20000);

    expect(datosBatch.productos[2].elementoId).toBe(p3.id);
    expect(datosBatch.productos[2].estado).toBe('INACTIVO');
    expect(datosBatch.productos[2].precioFinal).toBe(30000);

    // 2. Coherencia con GET /productos/catalogo
    const respCat = await listarProductosCatalogo();
    expect(respCat.status).toBe(200);
    const prodsCat = cuerpo<{
      productos: Array<{
        id: number;
        precioOriginal: number;
        precioFinal: number;
        descuentoAplicable: { estado: string } | null;
      }>;
    }>(respCat).productos;

    const catP1 = prodsCat.find((p) => p.id === p1.id);
    const catP2 = prodsCat.find((p) => p.id === p2.id);
    const catP3 = prodsCat.find((p) => p.id === p3.id);

    expect(catP1?.precioFinal).toBe(9000);
    expect(catP1?.descuentoAplicable?.estado).toBe('APLICADO');

    expect(catP2?.precioFinal).toBe(20000);
    expect(catP2?.descuentoAplicable).toBeNull();

    expect(catP3?.precioFinal).toBe(30000);
    expect(catP3?.descuentoAplicable?.estado).toBe('INACTIVO');

    // Invariante entre batch y catálogo
    expect(catP1?.precioFinal).toBe(datosBatch.productos[0].precioFinal);
    expect(catP2?.precioFinal).toBe(datosBatch.productos[1].precioFinal);
    expect(catP3?.precioFinal).toBe(datosBatch.productos[2].precioFinal);
  });
});

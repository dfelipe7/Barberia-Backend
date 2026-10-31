import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ForbiddenException,
  INestApplication,
  MiddlewareConsumer,
  Module,
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
import { ClientesAuthModule } from '../src/auth/clientes/clientes-auth.module';
import { GoogleTokenVerifier } from '../src/auth/google/google-token-verifier.service';
import { ServiciosModule } from '../src/modules/servicios/servicios.module';
import { UsuariosModule } from '../src/modules/usuarios/usuarios.module';
import { HorariosModule } from '../src/modules/horarios/horarios.module';
import { ReservasInfraModule } from '../src/modules/reservas/reservas-infra.module';
import { ReservasRepository } from '../src/modules/reservas/repository/reservas.repository';
import { ReservasController } from '../src/modules/reservas/controller/reservas.controller';
import { ReservasService } from '../src/modules/reservas/service/reservas.service';
import { ConfiguracionModule } from '../src/modules/configuracion/configuracion.module';
import { ConfiguracionService } from '../src/modules/configuracion/service/configuracion.service';
import { NegocioContextoService } from '../src/modules/negocios/negocio-contexto.service';

/**
 * SUITE NEGATIVA DE AISLAMIENTO MULTITENANT (Fase 7) CONTRA MARIADB REAL.
 *
 * Comprueba, sobre las RUTAS REALES y la BASE DE DATOS REAL, que un negocio
 * no puede consultar ni modificar datos de otro negocio aunque conozca
 * identificadores válidos.
 *
 * Casos cubiertos:
 *  1. Acceso a reservas de otro negocio (consulta, modificación, cancelación
 *     y listados) + verificación del estado final en la base de datos.
 *  2. Relaciones entre entidades de negocios diferentes (cliente + barbero +
 *     servicio) y asignación de servicios a barberos.
 *  3. Token ligado a un negocio (ámbito del token, cambio de cabecera,
 *     sesión global de SUPERADMIN, separación cliente/personal).
 *  4. Identificadores y catálogos públicos (`Barbero.id` vs `Usuario.id`).
 *  5. Configuración y caché por negocio.
 *  6. Contexto de negocio ausente o inválido.
 *  7. Acceso global de SUPERADMIN.
 *  8. Procesos de fondo y contrato con HU-11.
 *
 * Los datos son de prueba: `kyrios-studio` representa al primer negocio
 * (KYRIOS STUDIO) pero con clientes, barberos, servicios y reservas
 * FICTICIOS. Nunca se usan datos reales de KYRIOS STUDIO.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const FECHA = '2026-11-02'; // lunes
const HORA = '10:00';
const CLAVE_ANTELACION = 'reserva_cancelacion_antelacion_minutos';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ClientesAuthModule,
    ServiciosModule,
    UsuariosModule,
    HorariosModule,
    ReservasInfraModule,
    ConfiguracionModule,
    NegociosModule,
    PrismaModule,
  ],
  controllers: [ReservasController],
  providers: [ReservasService],
})
class AislamientoTestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Aislamiento negativo entre negocios (MariaDB real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prisma: PrismaClient;
  let app: INestApplication<App>;
  let contextoService: NegocioContextoService;
  let configuracionService: ConfiguracionService;
  let reservasRepository: ReservasRepository;

  /** Verificador de Google simulado: el "idToken" es el correo. */
  const verificarGoogle = jest.fn(async (idToken: string) => ({
    sub: `sub-${idToken}`,
    email: idToken,
    email_verified: true,
    given_name: 'Persona',
    family_name: 'Prueba',
  }));

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
    process.env.GOOGLE_CLIENT_ID = 'pruebas-aislamiento';
    process.env.JWT_SECRET = 'secreto-pruebas-aislamiento';
    process.env.JWT_CLIENTE_SECRET = 'secreto-cliente-pruebas-aislamiento';

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
      imports: [AislamientoTestModule],
    })
      .overrideProvider(GoogleTokenVerifier)
      .useValue({ verificar: verificarGoogle })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    contextoService = app.get(NegocioContextoService);
    configuracionService = app.get(ConfiguracionService);
    reservasRepository = app.get(ReservasRepository);
  }, 300000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();
  });

  /**
   * Siembra dos barberías con datos SEPARADOS y claramente diferenciados.
   *
   * `kyrios-studio` representa al primer negocio (KYRIOS STUDIO) y
   * `negocio-b` a una segunda barbería. `negocio-inactivo` está desactivado.
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
    const negocioInactivo = await prisma.negocio.upsert({
      where: { slug: 'negocio-inactivo' },
      update: {},
      create: {
        slug: 'negocio-inactivo',
        nombre: 'Negocio Inactivo',
        estado: 'INACTIVO',
      },
    });

    const crearUsuario = async (email: string, rol: string) =>
      prisma.usuario.upsert({
        where: { email },
        update: {},
        create: {
          email,
          nombre: 'Persona',
          apellido: 'Prueba',
          rol: rol as any,
        },
      });

    const adminA = await crearUsuario('admin-a@pruebas.local', 'PERSONAL');
    const superadmin = await crearUsuario('super@pruebas.local', 'SUPERADMIN');
    const barberoAUsuario = await crearUsuario(
      'barbero-a@pruebas.local',
      'PERSONAL',
    );
    const barberoBUsuario = await crearUsuario(
      'barbero-b@pruebas.local',
      'PERSONAL',
    );
    const clienteAUsuario = await crearUsuario(
      'cliente-a@pruebas.local',
      'PERSONAL',
    );
    const clienteBUsuario = await crearUsuario(
      'cliente-b@pruebas.local',
      'PERSONAL',
    );

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
        telefono: '3000000001',
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
        telefono: '3000000002',
        porcentajeComision: 10,
        negocioId: negocioB.id,
      },
    });

    // El SUPERADMIN tiene perfil de administrador de SU barbería con
    // `superadmin = true`: el carácter es de la MEMBRESÍA (Fase 10), no del
    // `Usuario.rol` global.
    await prisma.administrador.upsert({
      where: {
        negocioId_usuarioId: { negocioId: kyrios.id, usuarioId: superadmin.id },
      },
      update: { superadmin: true },
      create: {
        usuarioId: superadmin.id,
        negocioId: kyrios.id,
        superadmin: true,
      },
    });
    await prisma.administrador.upsert({
      where: {
        negocioId_usuarioId: { negocioId: kyrios.id, usuarioId: adminA.id },
      },
      update: {},
      create: {
        usuarioId: adminA.id,
        negocioId: kyrios.id,
        superadmin: false,
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

    const clienteA = await prisma.cliente.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        nombre: 'Cliente',
        apellido: 'A',
        telefono: '3111111111',
        email: 'cliente-a@pruebas.local',
        // El `googleId` coincide con el `sub` que devuelve el verificador de
        // Google simulado: el login de cliente recupera esta ficha.
        googleId: 'sub-cliente-a@pruebas.local',
        usuarioId: clienteAUsuario.id,
        negocioId: kyrios.id,
      },
    });
    const clienteB = await prisma.cliente.upsert({
      where: { id: 2 },
      update: {},
      create: {
        id: 2,
        nombre: 'Cliente',
        apellido: 'B',
        telefono: '3222222222',
        email: 'cliente-b@pruebas.local',
        googleId: 'sub-cliente-b@pruebas.local',
        usuarioId: clienteBUsuario.id,
        negocioId: negocioB.id,
      },
    });

    // Horario semanal de lunes 09:00-13:00 para cada barbero. La regla de
    // horario semanal compara por hora de INICIO, así que cada hora es una
    // franja propia.
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

    await prisma.reservation.deleteMany({});
    const reservaA = await prisma.reservation.create({
      data: {
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        clienteId: clienteA.id,
        date: new Date(`${FECHA}T00:00:00.000Z`),
        dayOfWeek: 'MONDAY',
        startTime: HORA,
        endTime: '11:00',
        status: 'CONFIRMED',
        negocioId: kyrios.id,
      },
    });
    const reservaB = await prisma.reservation.create({
      data: {
        barberoId: barberoB.id,
        servicioId: servicioB.id,
        clienteId: clienteB.id,
        date: new Date(`${FECHA}T00:00:00.000Z`),
        dayOfWeek: 'MONDAY',
        startTime: HORA,
        endTime: '11:00',
        status: 'CONFIRMED',
        negocioId: negocioB.id,
      },
    });

    // Configuración operativa propia de cada negocio.
    await prisma.configuracionNegocio.deleteMany({});
    await prisma.configuracionNegocio.create({
      data: {
        negocioId: kyrios.id,
        clave: CLAVE_ANTELACION,
        valor: '30',
        tipo: 'NUMERO',
        editable: true,
      },
    });
    await prisma.configuracionNegocio.create({
      data: {
        negocioId: negocioB.id,
        clave: CLAVE_ANTELACION,
        valor: '90',
        tipo: 'NUMERO',
        editable: true,
      },
    });

    return {
      kyrios,
      negocioB,
      negocioInactivo,
      adminA,
      superadmin,
      barberoA,
      barberoB,
      barberoAUsuario,
      barberoBUsuario,
      servicioA,
      servicioB,
      clienteA,
      clienteB,
      reservaA,
      reservaB,
    };
  };

  /** Inicia sesión de personal y devuelve el cuerpo de la respuesta. */
  const login = async (correo: string, slug?: string) => {
    const peticion = request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: correo });

    if (slug) {
      peticion.set('X-Negocio-Slug', slug);
    }

    const respuesta = await peticion;

    return respuesta.body as {
      accessToken: string;
      negocio: { id: number; slug: string } | null;
    };
  };

  /**
   * Token OPERATIVO (de negocio) para el correo indicado.
   *
   * Toda sesión está ligada a una barbería (no hay sesión de plataforma): el
   * login exige el contexto de negocio y una membresía activa en él.
   */
  const tokenOperativo = async (correo: string, slug: string) => {
    const sesion = await login(correo, slug);

    if (!sesion.negocio) {
      throw new Error(`No se pudo obtener la sesión operativa de '${slug}'`);
    }

    return sesion.accessToken;
  };

  /** Token de cliente (flujo de clientes, con secreto y audiencia propios). */
  const tokenDeCliente = async (correo: string) => {
    const respuesta = await request(app.getHttpServer())
      .post('/auth/clientes/google')
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({ idToken: correo });

    if (respuesta.status !== 200) {
      throw new Error(
        `No se pudo iniciar sesión de cliente (HTTP ${respuesta.status})`,
      );
    }

    return respuesta.body.accessToken as string;
  };

  /** Estado de una reserva tal y como queda en la base de datos. */
  const estadoEnBase = async (reservaId: number) => {
    const reserva = await prisma.reservation.findUnique({
      where: { id: reservaId },
    });

    return {
      status: reserva?.status,
      startTime: reserva?.startTime,
      endTime: reserva?.endTime,
      negocioId: reserva?.negocioId,
    };
  };

  // ---------------------------------------------------------------------
  // CASO 1: acceso a reservas de otro negocio
  // ---------------------------------------------------------------------

  it('1.1 no permite consultar una reserva de B desde el contexto de A', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { reservaB, negocioB } = await sembrar();

    const token = await tokenOperativo('super@pruebas.local', 'kyrios-studio');

    const detalle = await request(app.getHttpServer())
      .get(`/reservas/admin/${reservaB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(detalle.status).toBe(404);
    expect(detalle.body.message).toBe('La reserva no se encuentra disponible');

    // La reserva de B sigue intacta y en su negocio.
    expect(await estadoEnBase(reservaB.id)).toMatchObject({
      status: 'CONFIRMED',
      negocioId: negocioB.id,
    });
  });

  it('1.2 no permite modificar una reserva de B desde el contexto de A', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { reservaB } = await sembrar();

    const token = await tokenOperativo('super@pruebas.local', 'kyrios-studio');

    const modificacion = await request(app.getHttpServer())
      .patch(`/reservas/admin/${reservaB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({ hora: '12:00' });

    expect(modificacion.status).toBe(404);

    // La reserva de B NO se ha modificado.
    expect(await estadoEnBase(reservaB.id)).toMatchObject({
      status: 'CONFIRMED',
      startTime: HORA,
      endTime: '11:00',
    });
  });

  it('1.3 no permite cancelar una reserva de B desde el contexto de A', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { reservaB } = await sembrar();

    const token = await tokenOperativo('super@pruebas.local', 'kyrios-studio');

    const cancelacion = await request(app.getHttpServer())
      .patch(`/reservas/admin/${reservaB.id}/cancelar`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(cancelacion.status).toBe(404);

    // La reserva de B sigue CONFIRMED: un CANCELLED liberaría su franja.
    expect(await estadoEnBase(reservaB.id)).toMatchObject({
      status: 'CONFIRMED',
    });
  });

  it('1.4 los listados administrativos de A no incluyen reservas de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { reservaA, reservaB } = await sembrar();

    const token = await tokenOperativo('super@pruebas.local', 'kyrios-studio');

    const listado = await request(app.getHttpServer())
      .get('/reservas/admin')
      .query({ fecha: FECHA })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(listado.status).toBe(200);
    const ids = (listado.body as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toContain(reservaA.id);
    expect(ids).not.toContain(reservaB.id);
  });

  // ---------------------------------------------------------------------
  // CASO 2: relaciones entre entidades de negocios diferentes
  // ---------------------------------------------------------------------

  it('2.1 no crea una reserva con un barbero de B y un servicio de A', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoB, servicioA } = await sembrar();

    const antes = await prisma.reservation.count();

    const respuesta = await request(app.getHttpServer())
      .post('/reservas')
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({
        barberoId: barberoB.id,
        servicioId: servicioA.id,
        fecha: FECHA,
        hora: '11:00',
        nombre: 'Invitado',
        telefono: '3009999999',
      });

    // Rechazo por VALIDACIÓN DE APLICACIÓN: el barbero no existe en A.
    expect([400, 404]).toContain(respuesta.status);

    // No queda ninguna fila creada a medias.
    expect(await prisma.reservation.count()).toBe(antes);
  });

  it('2.2 no crea una reserva administrativa con un cliente de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoA, servicioA, clienteB } = await sembrar();

    const antes = await prisma.reservation.count();
    const token = await tokenOperativo(
      'admin-a@pruebas.local',
      'kyrios-studio',
    );

    const respuesta = await request(app.getHttpServer())
      .post('/reservas/admin')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        clienteId: clienteB.id,
        fecha: FECHA,
        hora: '11:00',
      });

    expect([400, 404]).toContain(respuesta.status);
    expect(await prisma.reservation.count()).toBe(antes);
  });

  it('2.3 no permite asignar a un servicio de A un barbero de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoB } = await sembrar();

    const token = await tokenOperativo(
      'admin-a@pruebas.local',
      'kyrios-studio',
    );

    const nombreServicio = `Servicio cruzado ${Date.now()}`;

    const respuesta = await request(app.getHttpServer())
      .post('/servicios')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({
        nombre: nombreServicio,
        precio: 10000,
        duracionMinutos: 30,
        barberoIds: [barberoB.id],
      });

    // Rechazo por VALIDACIÓN DE APLICACIÓN: el barbero no pertenece a A.
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.message).toContain(
      'Uno o más barberos seleccionados no existen',
    );

    // No se creó ningún servicio con el barbero ajeno.
    const creado = await prisma.servicio.findFirst({
      where: { nombre: nombreServicio },
      include: { barberos: true },
    });
    expect(creado?.barberos ?? []).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // CASO 3: token ligado a un negocio
  // ---------------------------------------------------------------------

  it('3.1 un token operativo de A se rechaza en el contexto de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const token = await tokenOperativo(
      'admin-a@pruebas.local',
      'kyrios-studio',
    );

    const respuesta = await request(app.getHttpServer())
      .get('/reservas/admin')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'negocio-b');

    expect(respuesta.status).toBe(403);
    expect(respuesta.body.message).toContain('otro negocio');
  });

  it('3.2 NO existe sesión de plataforma: el login exige contexto de negocio', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    // Sin contexto de barbería, el login se rechaza: no hay identidad global
    // de plataforma en este SaaS.
    const respuesta = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'super@pruebas.local' });

    expect(respuesta.status).toBe(403);
  });

  it('3.3 el cambio explícito de negocio valida la pertenencia', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    // El ADMINISTRADOR de A NO tiene perfil en B: la transición se rechaza.
    const tokenAdmin = await login('admin-a@pruebas.local', 'kyrios-studio');

    const adminAB = await request(app.getHttpServer())
      .post('/auth/tenant/negocio-b')
      .set('Authorization', `Bearer ${tokenAdmin.accessToken}`);

    expect(adminAB.status).toBe(403);

    // El SUPERADMIN es un rol de NEGOCIO: su transición exige la MEMBRESÍA en
    // el destino, igual que para el resto. No hay accesos privilegiados.
    const tokenSuper = await tokenOperativo(
      'super@pruebas.local',
      'kyrios-studio',
    );

    const superAB = await request(app.getHttpServer())
      .post('/auth/tenant/negocio-b')
      .set('Authorization', `Bearer ${tokenSuper}`);

    expect(superAB.status).toBe(403);

    // A su propia barbería sí puede cambiar (tiene la membresía).
    const superAA = await request(app.getHttpServer())
      .post('/auth/tenant/kyrios-studio')
      .set('Authorization', `Bearer ${tokenSuper}`);

    expect(superAA.status).toBe(201);
    expect(superAA.body.negocio).toEqual({
      id: expect.any(Number),
      slug: 'kyrios-studio',
    });
  });

  it('3.4 un token de cliente no autoriza rutas de personal', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const loginCliente = await request(app.getHttpServer())
      .post('/auth/clientes/google')
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({ idToken: 'cliente-a@pruebas.local' });

    expect(loginCliente.status).toBe(200);
    const tokenCliente = loginCliente.body.accessToken as string;

    const respuesta = await request(app.getHttpServer())
      .get('/reservas/admin')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(respuesta.status).toBe(401);
  });

  it('3.5 un token de cliente no sirve en otro negocio', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const loginCliente = await request(app.getHttpServer())
      .post('/auth/clientes/google')
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({ idToken: 'cliente-a@pruebas.local' });

    const tokenCliente = loginCliente.body.accessToken as string;

    const respuesta = await request(app.getHttpServer())
      .get('/reservas/me')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .set('X-Negocio-Slug', 'negocio-b');

    expect(respuesta.status).toBe(403);
  });

  it('3.6 un token de cliente inválido no degrada el flujo al acceso de invitado', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoA, servicioA } = await sembrar();

    const antes = await prisma.reservation.count();

    const respuesta = await request(app.getHttpServer())
      .post('/reservas')
      .set('Authorization', 'Bearer token-de-cliente-inexistente')
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        fecha: FECHA,
        hora: '11:00',
        nombre: 'Invitado',
        telefono: '3009999999',
      });

    // 401: nunca se degrada a invitado.
    expect(respuesta.status).toBe(401);
    expect(await prisma.reservation.count()).toBe(antes);
  });

  // ---------------------------------------------------------------------
  // CASO 4: identificadores y catálogos públicos
  // ---------------------------------------------------------------------

  it('4.1 A solo ve los servicios de A y sus barberos son de A', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoA, barberoB } = await sembrar();

    const respuesta = await request(app.getHttpServer())
      .get('/servicios')
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(respuesta.status).toBe(200);
    const servicios = respuesta.body as Array<{
      id: number;
      barberos: Array<{ id: number }>;
    }>;
    expect(servicios.map((s) => s.id)).toEqual([1]);
    expect(servicios[0].barberos.map((b) => b.id)).toEqual([barberoA.id]);
    expect(servicios[0].barberos.map((b) => b.id)).not.toContain(barberoB.id);
  });

  it('4.2 el detalle de un servicio de B no revela su existencia', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { servicioB } = await sembrar();

    const ajeno = await request(app.getHttpServer())
      .get(`/servicios/${servicioB.id}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    const inexistente = await request(app.getHttpServer())
      .get('/servicios/999999')
      .set('X-Negocio-Slug', 'kyrios-studio');

    // Misma respuesta: no se puede distinguir "existe en otra barbería".
    expect(ajeno.status).toBe(inexistente.status);
    expect(ajeno.body.message).toBe(inexistente.body.message);
  });

  it('4.3 la disponibilidad rechaza un barbero de B consultado desde A', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoB } = await sembrar();

    const respuesta = await request(app.getHttpServer())
      .get(`/usuarios/barberos/${barberoB.id}/disponibilidad`)
      .query({ fecha: FECHA })
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(respuesta.status).toBe(404);
  });

  it('4.4 un Usuario.id no se interpreta como Barbero.id', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoB, barberoBUsuario } = await sembrar();

    // Precondición: los identificadores son de familias distintas.
    expect(barberoB.id).not.toBe(barberoBUsuario.id);

    // Con el Barbero.id, B responde con sus servicios.
    const conBarberoId = await request(app.getHttpServer())
      .get(`/servicios/barbero/${barberoB.id}`)
      .set('X-Negocio-Slug', 'negocio-b');

    expect(conBarberoId.status).toBe(200);

    // Con el Usuario.id, no: no se resuelve por coincidencia numérica.
    const conUsuarioId = await request(app.getHttpServer())
      .get(`/servicios/barbero/${barberoBUsuario.id}`)
      .set('X-Negocio-Slug', 'negocio-b');

    expect(conUsuarioId.status).toBe(404);
  });

  // ---------------------------------------------------------------------
  // CASO 5: configuración y caché
  // ---------------------------------------------------------------------

  it('5.1 cada negocio lee su propia configuración operativa', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB } = await sembrar();
    configuracionService.invalidarCache();

    const enA = await contextoService.ejecutarEnContexto(kyrios, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );
    const enB = await contextoService.ejecutarEnContexto(negocioB, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );

    expect(enA).toBe(30);
    expect(enB).toBe(90);
  });

  it('5.2 invalidar la caché de A no cambia los valores de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB } = await sembrar();
    configuracionService.invalidarCache();

    await contextoService.ejecutarEnContexto(kyrios, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );
    const valorB = await contextoService.ejecutarEnContexto(negocioB, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );

    configuracionService.invalidarCacheNegocio(kyrios.id, CLAVE_ANTELACION);

    const valorBTrasInvalidar = await contextoService.ejecutarEnContexto(
      negocioB,
      () => configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );

    expect(valorBTrasInvalidar).toBe(valorB);
    expect(valorBTrasInvalidar).toBe(90);
  });

  it('5.3 una petición sin contexto no usa la configuración de otro negocio', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();
    configuracionService.invalidarCache();

    await expect(
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ---------------------------------------------------------------------
  // CASO 6: contexto de negocio ausente o inválido
  // ---------------------------------------------------------------------

  it('6.1 un slug inexistente se rechaza con 404', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const respuesta = await request(app.getHttpServer())
      .get('/servicios')
      .set('X-Negocio-Slug', 'no-existe');

    expect(respuesta.status).toBe(404);
  });

  it('6.2 un negocio inactivo se rechaza con 404', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioInactivo } = await sembrar();

    const respuesta = await request(app.getHttpServer())
      .get('/servicios')
      .set('X-Negocio-Slug', negocioInactivo.slug);

    expect(respuesta.status).toBe(404);
  });

  it('6.3 un endpoint tenant-scoped sin contexto falla de forma segura', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoA, servicioA } = await sembrar();

    const antes = await prisma.reservation.count();

    const respuesta = await request(app.getHttpServer())
      .post('/reservas')
      .send({
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        fecha: FECHA,
        hora: '11:00',
        nombre: 'Invitado',
        telefono: '3009999999',
      });

    // 403: la operación exige un contexto de negocio autorizado.
    expect(respuesta.status).toBe(403);
    expect(await prisma.reservation.count()).toBe(antes);
  });

  it('6.4 el login sin contexto de negocio se rechaza (no hay ámbito global)', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    // Toda sesión operativa está ligada a una barbería: sin contexto, el
    // login se rechaza con 403.
    const respuesta = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'super@pruebas.local' });

    expect(respuesta.status).toBe(403);
  });

  // ---------------------------------------------------------------------
  // CASO 7: el SUPERADMIN es un rol de negocio
  // ---------------------------------------------------------------------

  it('7.1 el SUPERADMIN opera SOLO en su barbería (el alcance es la membresía)', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { reservaA, reservaB } = await sembrar();

    // 1) Sesión operativa de SU barbería (tiene la membresía superadmin).
    const token = await tokenOperativo('super@pruebas.local', 'kyrios-studio');

    // 2) Con la sesión de negocio, el SUPERADMIN opera SOLO en A.
    const listado = await request(app.getHttpServer())
      .get('/reservas/admin')
      .query({ fecha: FECHA })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(listado.status).toBe(200);
    const ids = (listado.body as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toContain(reservaA.id);
    expect(ids).not.toContain(reservaB.id);
  });

  // ---------------------------------------------------------------------
  // CASO 8: procesos de fondo y contrato con HU-11
  // ---------------------------------------------------------------------

  it('8.1 el camino de datos del cron de recordatorios está acotado por negocio', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { reservaA, reservaB, kyrios, negocioB } = await sembrar();

    // HU-11: el cron fija el contexto de cada negocio ANTES de consultar y
    // el repositorio NO recorre los negocios: la consulta queda acotada al
    // negocio del contexto.
    const citasA = await contextoService.ejecutarEnContexto(kyrios, () =>
      reservasRepository.obtenerCitasPendientesRecordatorio(
        new Date(`${FECHA}T00:00:00.000Z`),
      ),
    );
    const citasB = await contextoService.ejecutarEnContexto(negocioB, () =>
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

    // Sin contexto, la consulta FALLA: nunca devuelve las citas de todos.
    await expect(
      reservasRepository.obtenerCitasPendientesRecordatorio(
        new Date(`${FECHA}T00:00:00.000Z`),
      ),
    ).rejects.toBeTruthy();
  });

  it('8.2 el cron de recordatorios NO consulta Prisma directamente (contrato de aislamiento)', async () => {
    // Comprobación CONTRACTUAL: el cron no accede a Prisma por su cuenta; el
    // aislamiento depende del repositorio, que exige el contexto de negocio
    // (Fase 9: el cron itera por los negocios y fija SU contexto). Si alguien
    // introduce una consulta directa, esta comprobación falla y avisa de que
    // hay que revisar el aislamiento.
    const fuente = readFileSync(
      join(
        __dirname,
        '..',
        'src',
        'modules',
        'reservas',
        'cron',
        'recordatorios.cron.ts',
      ),
      'utf8',
    );

    expect(fuente).not.toMatch(/prisma\./i);
    expect(fuente).toContain('obtenerCitasPendientesRecordatorio');
  });

  // ---------------------------------------------------------------------
  // CASO 9: integridad y concurrencia de las reservas
  // ---------------------------------------------------------------------

  it('9.1 la creación transaccional evita la doble reserva del mismo cliente en la misma franja', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoA, servicioA } = await sembrar();

    const tokenCliente = await tokenDeCliente('cliente-a@pruebas.local');

    const cuerpo = {
      barberoId: barberoA.id,
      servicioId: servicioA.id,
      fecha: FECHA,
      hora: '11:00',
    };

    const primera = await request(app.getHttpServer())
      .post('/reservas')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send(cuerpo);

    expect(primera.status).toBe(201);

    const segunda = await request(app.getHttpServer())
      .post('/reservas')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send(cuerpo);

    expect(segunda.status).toBe(409);

    // Solo existe UNA reserva en esa franja: no hay escritura parcial.
    const enLaFranja = await prisma.reservation.findMany({
      where: {
        barberoId: barberoA.id,
        date: new Date(`${FECHA}T00:00:00.000Z`),
        startTime: '11:00',
      },
    });
    expect(enLaFranja).toHaveLength(1);
  });

  it('9.2 CANCELLED libera la franja', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { reservaA, barberoA, servicioA } = await sembrar();

    const tokenSuper = await tokenOperativo(
      'super@pruebas.local',
      'kyrios-studio',
    );

    const cancelacion = await request(app.getHttpServer())
      .patch(`/reservas/admin/${reservaA.id}/cancelar`)
      .set('Authorization', `Bearer ${tokenSuper}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(cancelacion.status).toBe(200);
    expect(await estadoEnBase(reservaA.id)).toMatchObject({
      status: 'CANCELLED',
    });

    // La franja liberada se puede volver a reservar.
    const tokenCliente = await tokenDeCliente('cliente-a@pruebas.local');

    const nueva = await request(app.getHttpServer())
      .post('/reservas')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        fecha: FECHA,
        hora: HORA,
      });

    expect(nueva.status).toBe(201);
  });

  it('9.3 NO_SHOW mantiene ocupada la franja', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { barberoA, servicioA } = await sembrar();

    // Un lunes PASADO (2026-10-19): la franja ya ha transcurrido y se puede
    // marcar como NO_SHOW.
    const fechaPasada = '2026-10-19';

    const tokenCliente = await tokenDeCliente('cliente-a@pruebas.local');

    const creada = await request(app.getHttpServer())
      .post('/reservas')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        fecha: fechaPasada,
        hora: HORA,
      });

    expect(creada.status).toBe(201);
    const reservaId = creada.body.id as number;

    const tokenSuper = await tokenOperativo(
      'super@pruebas.local',
      'kyrios-studio',
    );

    const noShow = await request(app.getHttpServer())
      .patch(`/reservas/${reservaId}/no-show`)
      .set('Authorization', `Bearer ${tokenSuper}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(noShow.status).toBe(200);
    expect(await estadoEnBase(reservaId)).toMatchObject({ status: 'NO_SHOW' });

    // La franja sigue OCUPADA: otra reserva en el mismo horario se rechaza.
    const otra = await request(app.getHttpServer())
      .post('/reservas')
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        fecha: fechaPasada,
        hora: HORA,
        nombre: 'Otro invitado',
        telefono: '3008888888',
      });

    expect(otra.status).toBe(409);
  });
});

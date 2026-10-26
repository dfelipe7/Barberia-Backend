import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { INestApplication, MiddlewareConsumer, Module } from '@nestjs/common';
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
import { ConfiguracionModule } from '../src/modules/configuracion/configuracion.module';
import { WhatsAppModule } from '../src/modules/whatsapp/whatsapp.module';

/**
 * SUPERADMIN POR NEGOCIO (Fase 10) CONTRA MARIADB REAL.
 *
 * En este SaaS el SUPERADMIN es un ROL DE NEGOCIO: la membresía
 * `Administrador.superadmin` de UNA barbería. No existe superadmin de
 * plataforma ni sesión de plataforma.
 *
 * Casos cubiertos:
 *  1. Los SUPERADMIN de cada barbería administran SU barbería.
 *  2. Un SUPERADMIN de A NO puede leer ni modificar datos de B (y al revés).
 *  3. Un SUPERADMIN de A NO puede cambiar a B sin membresía autorizada.
 *  4. Un token de A reutilizado en el contexto de B devuelve 403.
 *  5. Un ADMINISTRADOR (sin `superadmin`) NO obtiene poderes de SUPERADMIN.
 *  6. `Usuario.rol = 'SUPERADMIN'` SIN membresía no concede ningún acceso.
 *  7. La migración NO promueve las membresías existentes (siguen en ADMINISTRADOR).
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const FECHA = '2026-11-02'; // lunes
const HORA = '10:00';

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
    WhatsAppModule,
    NegociosModule,
    PrismaModule,
  ],
})
class SuperadminTenantTestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('SUPERADMIN por negocio (MariaDB real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prisma: PrismaClient;
  let app: INestApplication<App>;

  /** Verificador de Google simulado: el "idToken" es el correo. */
  const verificarGoogle = jest.fn((idToken: string) =>
    Promise.resolve({
      sub: `sub-${idToken}`,
      email: idToken,
      email_verified: true,
      given_name: 'Persona',
      family_name: 'Prueba',
    }),
  );

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
    process.env.GOOGLE_CLIENT_ID = 'pruebas-superadmin';
    process.env.JWT_SECRET = 'secreto-pruebas-superadmin';
    process.env.JWT_CLIENTE_SECRET = 'secreto-cliente-pruebas-superadmin';

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
      imports: [SuperadminTenantTestModule],
    })
      .overrideProvider(GoogleTokenVerifier)
      .useValue({ verificar: verificarGoogle })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 300000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();
  });

  /**
   * Siembra DOS barberías con sus miembros y sus datos:
   *
   * - KYRIOS STUDIO (`kyrios-studio`): Duvan y Javier son SUPERADMIN;
   *   además hay un ADMINISTRADOR simple (para comprobar que no hereda
   *   poderes de SUPERADMIN) y una persona con `Usuario.rol = 'SUPERADMIN'`
   *   SIN membresía (para comprobar que el valor global no concede nada).
   * - BARBERÍA DEMO 2 (`barberia-demo-2`): Rubeiro y Santiago son SUPERADMIN.
   */
  const sembrar = async () => {
    const kyrios = await prisma.negocio.upsert({
      where: { slug: 'kyrios-studio' },
      update: {},
      create: { slug: 'kyrios-studio', nombre: 'KYRIOS STUDIO' },
    });
    const demo2 = await prisma.negocio.upsert({
      where: { slug: 'barberia-demo-2' },
      update: {},
      create: { slug: 'barberia-demo-2', nombre: 'BARBERÍA DEMO 2' },
    });

    const crearUsuario = async (
      email: string,
      rol: 'SUPERADMIN' | 'PERSONAL' = 'PERSONAL',
    ) =>
      prisma.usuario.upsert({
        where: { email },
        update: {},
        create: {
          email,
          nombre: 'Persona',
          apellido: 'Prueba',
          rol,
          estado: 'ACTIVO',
        },
      });

    const duvan = await crearUsuario('duvan@pruebas.local');
    const javier = await crearUsuario('javier@pruebas.local');
    const rubeiro = await crearUsuario('rubeiro@pruebas.local');
    const santiago = await crearUsuario('santiago@pruebas.local');
    const adminSimple = await crearUsuario('admin-simple@pruebas.local');
    // Identidad con el ROL GLOBAL heredado, pero SIN membresía en ninguna
    // barbería: no debe poder entrar.
    const sinMembresia = await crearUsuario(
      'sin-membresia@pruebas.local',
      'SUPERADMIN',
    );

    // Membresías: SUPERADMIN de su propia barbería.
    await prisma.administrador.deleteMany({});
    const membresias: Array<[number, number, boolean]> = [
      [duvan.id, kyrios.id, true],
      [javier.id, kyrios.id, true],
      [adminSimple.id, kyrios.id, false],
      [rubeiro.id, demo2.id, true],
      [santiago.id, demo2.id, true],
    ];

    for (const [usuarioId, negocioId, superadmin] of membresias) {
      await prisma.administrador.create({
        data: { usuarioId, negocioId, superadmin, estado: 'ACTIVO' },
      });
    }

    // Un barbero y un servicio en cada barbería.
    const barberoUsuario = await crearUsuario('barbero@pruebas.local');
    const barbero = await prisma.barbero.upsert({
      where: {
        negocioId_usuarioId: {
          negocioId: kyrios.id,
          usuarioId: barberoUsuario.id,
        },
      },
      update: {},
      create: {
        usuarioId: barberoUsuario.id,
        telefono: '3000000099',
        porcentajeComision: 10,
        negocioId: kyrios.id,
      },
    });

    const barberoDemoUsuario = await crearUsuario('barbero-demo@pruebas.local');
    const barberoDemo = await prisma.barbero.upsert({
      where: {
        negocioId_usuarioId: {
          negocioId: demo2.id,
          usuarioId: barberoDemoUsuario.id,
        },
      },
      update: {},
      create: {
        usuarioId: barberoDemoUsuario.id,
        telefono: '3000000098',
        porcentajeComision: 10,
        negocioId: demo2.id,
      },
    });

    const servicioA = await prisma.servicio.upsert({
      where: { id: 401 },
      update: {},
      create: {
        id: 401,
        nombre: 'Corte KYRIOS',
        precio: 20000,
        duracionMinutos: 30,
        negocioId: kyrios.id,
      },
    });
    const servicioB = await prisma.servicio.upsert({
      where: { id: 402 },
      update: {},
      create: {
        id: 402,
        nombre: 'Corte DEMO 2',
        precio: 25000,
        duracionMinutos: 30,
        negocioId: demo2.id,
      },
    });

    const clienteA = await prisma.cliente.upsert({
      where: { id: 501 },
      update: {},
      create: {
        id: 501,
        nombre: 'Cliente',
        apellido: 'A',
        telefono: '3111111111',
        negocioId: kyrios.id,
      },
    });

    const clienteB = await prisma.cliente.upsert({
      where: { id: 502 },
      update: {},
      create: {
        id: 502,
        nombre: 'Cliente',
        apellido: 'B',
        telefono: '3222222222',
        negocioId: demo2.id,
      },
    });

    await prisma.reservation.deleteMany({ where: { id: { in: [601, 602] } } });

    const reservaA = await prisma.reservation.create({
      data: {
        id: 601,
        barberoId: barbero.id,
        servicioId: servicioA.id,
        clienteId: clienteA.id,
        date: new Date(`${FECHA}T00:00:00.000Z`),
        dayOfWeek: 'MONDAY',
        startTime: HORA,
        endTime: '10:30',
        status: 'CONFIRMED',
        negocioId: kyrios.id,
      },
    });

    const reservaB = await prisma.reservation.create({
      data: {
        id: 602,
        barberoId: barberoDemo.id,
        servicioId: servicioB.id,
        clienteId: clienteB.id,
        date: new Date(`${FECHA}T00:00:00.000Z`),
        dayOfWeek: 'MONDAY',
        startTime: HORA,
        endTime: '10:30',
        status: 'CONFIRMED',
        negocioId: demo2.id,
      },
    });

    // Plantilla propia de cada barbería y plantilla global.
    await prisma.whatsAppPlantilla.deleteMany({});
    await prisma.whatsAppPlantilla.create({
      data: { tipo: 'CONFIRMACION', mensaje: 'Texto global' },
    });
    await prisma.whatsAppPlantilla.create({
      data: {
        tipo: 'CONFIRMACION',
        mensaje: 'Texto de KYRIOS',
        negocioId: kyrios.id,
      },
    });
    await prisma.whatsAppPlantilla.create({
      data: {
        tipo: 'CONFIRMACION',
        mensaje: 'Texto de DEMO 2',
        negocioId: demo2.id,
      },
    });

    return {
      kyrios,
      demo2,
      duvan,
      javier,
      rubeiro,
      santiago,
      adminSimple,
      sinMembresia,
      servicioA,
      servicioB,
      reservaA,
      reservaB,
    };
  };

  /** Inicia sesión de personal en el negocio indicado. */
  const login = async (correo: string, slug: string) => {
    const respuesta = await request(app.getHttpServer())
      .post('/auth/google')
      .set('X-Negocio-Slug', slug)
      .send({ idToken: correo });

    return respuesta;
  };

  /** Token de negocio para el correo indicado (o `null` si el login falla). */
  const tokenDe = async (correo: string, slug: string) => {
    const respuesta = await login(correo, slug);

    if (respuesta.status !== 201) {
      throw new Error(
        `No se pudo iniciar sesión de '${correo}' en '${slug}' (HTTP ${respuesta.status})`,
      );
    }

    return (respuesta.body as { accessToken: string }).accessToken;
  };

  it('1. los SUPERADMIN administran SU barbería (y solo ella)', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, demo2, servicioA, servicioB } = await sembrar();

    const tokenDuvan = await tokenDe('duvan@pruebas.local', 'kyrios-studio');
    const tokenRubeiro = await tokenDe(
      'rubeiro@pruebas.local',
      'barberia-demo-2',
    );

    // Duvan ve el catálogo de SU barbería.
    const catalogoDuvan = await request(app.getHttpServer())
      .get('/servicios/gestion')
      .set('Authorization', `Bearer ${tokenDuvan}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(catalogoDuvan.status).toBe(200);
    const idsDuvan = (catalogoDuvan.body as Array<{ id: number }>).map(
      (s) => s.id,
    );
    expect(idsDuvan).toContain(servicioA.id);
    expect(idsDuvan).not.toContain(servicioB.id);

    // Rubeiro ve el de la suya.
    const catalogoRubeiro = await request(app.getHttpServer())
      .get('/servicios/gestion')
      .set('Authorization', `Bearer ${tokenRubeiro}`)
      .set('X-Negocio-Slug', 'barberia-demo-2');

    expect(catalogoRubeiro.status).toBe(200);
    const idsRubeiro = (catalogoRubeiro.body as Array<{ id: number }>).map(
      (s) => s.id,
    );
    expect(idsRubeiro).toContain(servicioB.id);
    expect(idsRubeiro).not.toContain(servicioA.id);

    expect(kyrios.id).not.toBe(demo2.id);
  });

  it('2. un SUPERADMIN de A NO puede leer datos privados de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { servicioB, reservaB } = await sembrar();

    const tokenDuvan = await tokenDe('duvan@pruebas.local', 'kyrios-studio');

    // Servicio de B: no existe para el superadmin de A.
    const servicio = await request(app.getHttpServer())
      .get(`/servicios/${servicioB.id}`)
      .set('Authorization', `Bearer ${tokenDuvan}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect([403, 404]).toContain(servicio.status);

    // Reserva de B: tampoco.
    const reserva = await request(app.getHttpServer())
      .get(`/reservas/admin/${reservaB.id}`)
      .set('Authorization', `Bearer ${tokenDuvan}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect([403, 404]).toContain(reserva.status);
  });

  it('3. un SUPERADMIN de A NO puede MODIFICAR datos de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { servicioB, reservaB } = await sembrar();

    const tokenDuvan = await tokenDe('duvan@pruebas.local', 'kyrios-studio');

    const modificarServicio = await request(app.getHttpServer())
      .patch(`/servicios/${servicioB.id}`)
      .set('Authorization', `Bearer ${tokenDuvan}`)
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({ nombre: 'Intruso', precio: 1 });

    expect([403, 404]).toContain(modificarServicio.status);

    const cancelarReserva = await request(app.getHttpServer())
      .patch(`/reservas/admin/${reservaB.id}/cancelar`)
      .set('Authorization', `Bearer ${tokenDuvan}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect([403, 404]).toContain(cancelarReserva.status);

    // El servicio de B sigue intacto.
    const servicio = await prisma.servicio.findUnique({
      where: { id: servicioB.id },
      select: { nombre: true, precio: true },
    });
    expect(servicio?.nombre).toBe('Corte DEMO 2');
  });

  it('4. un SUPERADMIN de A NO puede cambiar a B sin membresía autorizada', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const tokenDuvan = await tokenDe('duvan@pruebas.local', 'kyrios-studio');

    const cambio = await request(app.getHttpServer())
      .post('/auth/tenant/barberia-demo-2')
      .set('Authorization', `Bearer ${tokenDuvan}`);

    expect(cambio.status).toBe(403);
  });

  it('5. un token de A reutilizado en el contexto de B devuelve 403', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const tokenDuvan = await tokenDe('duvan@pruebas.local', 'kyrios-studio');

    const respuesta = await request(app.getHttpServer())
      .get('/servicios/gestion')
      .set('Authorization', `Bearer ${tokenDuvan}`)
      .set('X-Negocio-Slug', 'barberia-demo-2');

    expect(respuesta.status).toBe(403);
  });

  it('6. un ADMINISTRADOR no obtiene privilegios de SUPERADMIN', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { servicioA } = await sembrar();

    const tokenAdmin = await tokenDe(
      'admin-simple@pruebas.local',
      'kyrios-studio',
    );

    // Un ADMINISTRADOR NO puede administrar a los administradores (ruta
    // exclusiva del SUPERADMIN de la barbería).
    const listar = await request(app.getHttpServer())
      .get('/usuarios/administradores')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(listar.status).toBe(403);

    // Tampoco puede crear un servicio reservado al SUPERADMIN... (las rutas
    // de servicios admiten a ambos), pero SÍ puede ver el catálogo: lo que no
    // puede es el poder exclusivo del superadmin.
    const catalogo = await request(app.getHttpServer())
      .get('/servicios/gestion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(catalogo.status).toBe(200);
    const ids = (catalogo.body as Array<{ id: number }>).map((s) => s.id);
    expect(ids).toContain(servicioA.id);
  });

  it('7. Usuario.rol = SUPERADMIN sin membresía NO concede acceso', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    // El login se rechaza: no hay perfil activo en ese negocio.
    const respuesta = await login(
      'sin-membresia@pruebas.local',
      'kyrios-studio',
    );

    expect(respuesta.status).toBe(403);
  });

  it('8. la migración NO promueve las membresías existentes', async () => {
    if (OMITIR_SIN_DOCKER) return;

    // Las membresías creadas por la migración quedan con `superadmin = false`
    // (valor por defecto): una fila anterior a la migración es ADMINISTRADOR.
    await prisma.administrador.create({
      data: {
        usuarioId: (
          await prisma.usuario.upsert({
            where: { email: 'migrado@pruebas.local' },
            update: {},
            create: {
              email: 'migrado@pruebas.local',
              nombre: 'Migrado',
              apellido: 'Prueba',
              rol: 'PERSONAL',
            },
          })
        ).id,
        negocioId: (
          await prisma.negocio.upsert({
            where: { slug: 'kyrios-studio' },
            update: {},
            create: { slug: 'kyrios-studio', nombre: 'KYRIOS STUDIO' },
          })
        ).id,
        // Sin indicar `superadmin`: el valor por defecto de la migración.
      },
    });

    const membresia = await prisma.administrador.findFirst({
      where: { usuario: { email: 'migrado@pruebas.local' } },
      select: { superadmin: true },
    });

    expect(membresia?.superadmin).toBe(false);
  });

  it('9. un SUPERADMIN solo gestiona usuarios y administradores de SU barbería', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { rubeiro } = await sembrar();

    const tokenDuvan = await tokenDe('duvan@pruebas.local', 'kyrios-studio');

    // El listado de administradores de A NO incluye a los de B.
    const listar = await request(app.getHttpServer())
      .get('/usuarios/administradores')
      .set('Authorization', `Bearer ${tokenDuvan}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(listar.status).toBe(200);
    const administradores = listar.body as Array<{ email: string }>;
    const correos = administradores.map((a) => a.email);
    expect(correos).toContain('duvan@pruebas.local');
    expect(correos).toContain('javier@pruebas.local');
    expect(correos).not.toContain('rubeiro@pruebas.local');
    expect(correos).not.toContain('santiago@pruebas.local');

    // Y no puede cambiar el estado de la cuenta de un miembro de B.
    const cambiar = await request(app.getHttpServer())
      .patch(`/usuarios/administradores/${rubeiro.id}/estado`)
      .set('Authorization', `Bearer ${tokenDuvan}`)
      .set('X-Negocio-Slug', 'kyrios-studio')
      .send({ estado: 'INACTIVO' });

    expect([403, 404]).toContain(cambiar.status);
  });

  it('10. las plantillas de WhatsApp también son por negocio', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const tokenDuvan = await tokenDe('duvan@pruebas.local', 'kyrios-studio');

    const plantillas = await request(app.getHttpServer())
      .get('/whatsapp/plantillas')
      .set('Authorization', `Bearer ${tokenDuvan}`)
      .set('X-Negocio-Slug', 'kyrios-studio');

    expect(plantillas.status).toBe(200);
    expect((plantillas.body as { confirmacion: string }).confirmacion).toBe(
      'Texto de KYRIOS',
    );
  });
});

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
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
import { AuthModule } from '../src/auth/auth.module';
import { GoogleTokenVerifier } from '../src/auth/google/google-token-verifier.service';
import { NegocioContextoMiddleware } from '../src/modules/negocios/middleware/negocio-contexto.middleware';
import { NegociosModule } from '../src/modules/negocios/negocios.module';
import { PerfilNegocioModule } from '../src/modules/perfil-negocio/perfil-negocio.module';
import { PrismaModule } from '../src/prisma/prisma.module';

/**
 * PERFIL DE MARCA Y UBICACIÓN POR NEGOCIO CONTRA MYSQL 8.0 REAL (Fase 14).
 *
 * Levanta un contenedor **MySQL 8.0.46 efímero** (motor del entorno local
 * de desarrollo), aplica las migraciones REALES del proyecto y monta una
 * aplicación Nest con los guards, el middleware de contexto, la extensión de
 * aislamiento de Prisma y el módulo de perfil REALES.
 *
 * Solo se sustituye la verificación criptográfica de Google por un
 * simulador: lo que se comprueba es el aislamiento entre negocios, la
 * autorización por roles EFECTIVOS y las validaciones de la ubicación.
 *
 * Escenarios:
 *  1. La vista pública sin contexto de negocio se rechaza.
 *  2. Un negocio sin perfil configurado responde 200 con `configurado: false`.
 *  3. El SUPERADMIN de A puede configurar el perfil de A.
 *  4. El ADMINISTRADOR de A puede configurar el perfil de A.
 *  5. El BARBERO de A NO puede configurar el perfil.
 *  6. Quien no tiene membresía activa no puede ni iniciar sesión.
 *  7. El SUPERADMIN de A no puede operar en B.
 *  8. El perfil de A no se expone cuando el contexto es B.
 *  9. Las coordenadas fuera de rango se rechazan.
 * 10. Las coordenadas parciales se rechazan.
 * 11. Las coordenadas válidas se aceptan y derivan la URL del mapa.
 * 12. Un perfil incompleto se acepta.
 * 13. Las referencias visuales de A no aparecen en B.
 * 14. El cuerpo no puede forzar un `negocioId`.
 * 15. Una referencia de archivo debe ser una ruta o una URL http/https.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const SECRETO_PERSONAL = 'secreto-personal-fase14-e2e';

const SLUG_A = 'negocio-a';
const SLUG_B = 'negocio-b';

/**
 * Cuerpo de la respuesta, tipado.
 *
 * `supertest` declara `body` como `any`: sin este tipo, cada acceso
 * propagaría el `any` y el análisis estático no podría comprobar nada.
 */
function cuerpo<T>(respuesta: Response): T {
  return (respuesta.body ?? {}) as T;
}

/** Cuerpo de la vista pública del perfil. */
interface PerfilPublico {
  configurado: boolean;
  frasePrincipal: string | null;
  faviconUrl: string | null;
  bannerUrl: string | null;
  direccion: string | null;
  ciudad: string | null;
  latitud: number | null;
  longitud: number | null;
  mapsUrl: string | null;
  negocio: { nombre: string; slug: string };
}

/** Cuerpo de la vista de gestión del perfil. */
interface PerfilGestion {
  configurado: boolean;
  contenido: { frasePrincipal: string | null };
  ubicacion: {
    direccion: string | null;
    ciudad: string | null;
    latitud: number | null;
    longitud: number | null;
    mapsUrl: string | null;
  };
  referenciasArchivo: {
    faviconUrl: string | null;
    bannerUrl: string | null;
  };
}

/** Cuerpo de la respuesta de inicio de sesión. */
interface SesionEmitida {
  accessToken?: string;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    NegociosModule,
    PrismaModule,
    PerfilNegocioModule,
  ],
})
class PruebaPerfilModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Perfil de marca y ubicación por negocio (MySQL 8.0 real)', () => {
  let conexion: MariaDbConnection | undefined;
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  /** Token de Google simulado: el "idToken" es el correo del usuario. */
  const verificarGoogle = jest.fn((idToken: string) =>
    Promise.resolve({
      sub: `sub-${idToken}`,
      email: idToken,
      email_verified: true,
      given_name: 'Persona',
    }),
  );

  beforeAll(async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    conexion = await MariaDbConnection.start({
      motor: 'mysql',
      lowerCaseTableNames: false,
    });

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
    process.env.JWT_SECRET = SECRETO_PERSONAL;
    process.env.NEGOCIO_PERMITIR_HEADER_SLUG = 'true';

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
      imports: [PruebaPerfilModule],
    })
      .overrideProvider(GoogleTokenVerifier)
      .useValue({ verificar: verificarGoogle })
      .compile();

    app = moduleRef.createNestApplication();

    // Mismas reglas de validación que la aplicación real.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  }, 300000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();
  });

  /**
   * Crea los dos negocios y las personas de prueba.
   *
   * En A hay un SUPERADMIN, un ADMINISTRADOR y un BARBERO. En B, un
   * SUPERADMIN. Fuera de todo, alguien sin ninguna membresía.
   */
  const sembrar = async () => {
    const negocioA = await prisma.negocio.upsert({
      where: { slug: SLUG_A },
      update: {},
      create: { slug: SLUG_A, nombre: 'Negocio A' },
    });
    const negocioB = await prisma.negocio.upsert({
      where: { slug: SLUG_B },
      update: {},
      create: { slug: SLUG_B, nombre: 'Negocio B' },
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

    const superA = await crearUsuario('super-a@test.local');
    const adminA = await crearUsuario('admin-a@test.local');
    const barberoA = await crearUsuario('barbero-a@test.local');
    const superB = await crearUsuario('super-b@test.local');
    const sinPerfil = await crearUsuario('sinperfil@test.local');

    await prisma.administrador.upsert({
      where: {
        negocioId_usuarioId: { negocioId: negocioA.id, usuarioId: superA.id },
      },
      update: { superadmin: true },
      create: {
        usuarioId: superA.id,
        negocioId: negocioA.id,
        superadmin: true,
      },
    });

    await prisma.administrador.upsert({
      where: {
        negocioId_usuarioId: { negocioId: negocioA.id, usuarioId: adminA.id },
      },
      update: { superadmin: false },
      create: {
        usuarioId: adminA.id,
        negocioId: negocioA.id,
        superadmin: false,
      },
    });

    await prisma.administrador.upsert({
      where: {
        negocioId_usuarioId: { negocioId: negocioB.id, usuarioId: superB.id },
      },
      update: { superadmin: true },
      create: {
        usuarioId: superB.id,
        negocioId: negocioB.id,
        superadmin: true,
      },
    });

    await prisma.barbero.upsert({
      where: {
        negocioId_usuarioId: { negocioId: negocioA.id, usuarioId: barberoA.id },
      },
      update: {},
      create: {
        usuarioId: barberoA.id,
        negocioId: negocioA.id,
        telefono: '300',
        porcentajeComision: 10,
      },
    });

    return { negocioA, negocioB, superA, adminA, barberoA, superB, sinPerfil };
  };

  /** Inicia sesión y devuelve el token de la barbería indicada. */
  const login = async (
    correo: string,
    slug: string,
  ): Promise<{ status: number; token: string | undefined }> => {
    const respuesta = await request(app.getHttpServer())
      .post('/auth/google')
      .set('X-Negocio-Slug', slug)
      .send({ idToken: correo });

    return {
      status: respuesta.status,
      token: cuerpo<SesionEmitida>(respuesta).accessToken,
    };
  };

  it('1. la vista publica sin contexto de negocio se rechaza', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const respuesta = await request(app.getHttpServer()).get('/perfil-negocio');

    expect(respuesta.status).toBe(403);
  });

  it('2. un negocio sin perfil configurado responde 200 con configurado=false', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const respuesta = await request(app.getHttpServer())
      .get('/perfil-negocio')
      .set('X-Negocio-Slug', SLUG_A);

    expect(respuesta.status).toBe(200);

    const perfil = cuerpo<PerfilPublico>(respuesta);

    expect(perfil.configurado).toBe(false);
    expect(perfil.frasePrincipal).toBeNull();
    expect(perfil.latitud).toBeNull();
    expect(perfil.mapsUrl).toBeNull();
    expect(perfil.negocio.slug).toBe(SLUG_A);
  });

  it('3. el SUPERADMIN de A puede configurar el perfil de A', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const { token } = await login('super-a@test.local', SLUG_A);

    const respuesta = await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({
        frasePrincipal: 'Barbería de alto estándar',
        direccion: 'Vía al Bosque, Tv 9A Norte',
        ciudad: 'Popayán',
        departamento: 'Cauca',
        referencia: 'Local 2',
        latitud: 2.4839891,
        longitud: -76.5807622,
      });

    expect(respuesta.status).toBe(200);

    const perfil = cuerpo<PerfilGestion>(respuesta);

    expect(perfil.configurado).toBe(true);
    expect(perfil.contenido.frasePrincipal).toBe('Barbería de alto estándar');
    expect(perfil.ubicacion.ciudad).toBe('Popayán');
    expect(perfil.ubicacion.mapsUrl).toBe(
      'https://www.google.com/maps/search/?api=1&query=2.4839891,-76.5807622',
    );
  });

  it('4. el ADMINISTRADOR de A puede configurar el perfil de A', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA } = await sembrar();

    const { token } = await login('admin-a@test.local', SLUG_A);

    // Las referencias internas deben apuntar al espacio de recursos del
    // PROPIO negocio (Fase 15).
    const propio = `/uploads/negocios/${negocioA.id}/perfil`;

    const respuesta = await request(app.getHttpServer())
      .put('/perfil-negocio/referencias')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({
        faviconUrl: `${propio}/favicon.png`,
        bannerUrl: `${propio}/banner.png`,
        logoBlancoUrl: `${propio}/logo-blanco.png`,
        logoNegroUrl: `${propio}/logo-negro.png`,
      });

    expect(respuesta.status).toBe(200);
    expect(cuerpo<PerfilGestion>(respuesta).referenciasArchivo.faviconUrl).toBe(
      `${propio}/favicon.png`,
    );
  });

  it('5. el BARBERO de A NO puede configurar el perfil', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const { token } = await login('barbero-a@test.local', SLUG_A);

    const respuesta = await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ frasePrincipal: 'No debería poder' });

    expect(respuesta.status).toBe(403);
  });

  it('6. quien no tiene membresia activa no puede ni iniciar sesion', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const { status, token } = await login('sinperfil@test.local', SLUG_A);

    expect(status).toBe(403);
    expect(token).toBeUndefined();
  });

  it('7. el SUPERADMIN de A no puede operar en B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const { token } = await login('super-a@test.local', SLUG_A);

    const escritura = await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_B)
      .send({ frasePrincipal: 'Intrusión' });

    expect(escritura.status).toBe(403);

    const lectura = await request(app.getHttpServer())
      .get('/perfil-negocio/gestion')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_B);

    expect(lectura.status).toBe(403);
  });

  it('8. el perfil de A no se expone cuando el contexto es B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const { token } = await login('super-a@test.local', SLUG_A);

    await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({
        frasePrincipal: 'Marca exclusiva de A',
        latitud: 2.4839891,
        longitud: -76.5807622,
      });

    const enB = await request(app.getHttpServer())
      .get('/perfil-negocio')
      .set('X-Negocio-Slug', SLUG_B);

    expect(enB.status).toBe(200);

    const perfilB = cuerpo<PerfilPublico>(enB);

    expect(perfilB.negocio.slug).toBe(SLUG_B);
    expect(perfilB.frasePrincipal).toBeNull();
    expect(perfilB.latitud).toBeNull();
    expect(perfilB.mapsUrl).toBeNull();
  });

  it('9. las coordenadas fuera de rango se rechazan', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const { token } = await login('super-a@test.local', SLUG_A);

    const latitudFuera = await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ latitud: 91, longitud: -76.5807622 });

    expect(latitudFuera.status).toBe(400);

    const longitudFuera = await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ latitud: 2.4839891, longitud: -181 });

    expect(longitudFuera.status).toBe(400);

    const noNumerico = await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ latitud: 'abc', longitud: -76.5807622 });

    expect(noNumerico.status).toBe(400);
  });

  it('10. las coordenadas parciales se rechazan', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const { token } = await login('super-a@test.local', SLUG_A);

    const soloLatitud = await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ latitud: 2.4839891 });

    expect(soloLatitud.status).toBe(400);

    const soloLongitud = await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ longitud: -76.5807622 });

    expect(soloLongitud.status).toBe(400);
  });

  it('11. un perfil incompleto se acepta', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const { token } = await login('super-a@test.local', SLUG_A);

    const respuesta = await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ frasePrincipal: 'Solo la frase' });

    expect(respuesta.status).toBe(200);

    const perfil = cuerpo<PerfilGestion>(respuesta);

    expect(perfil.contenido.frasePrincipal).toBe('Solo la frase');
    expect(perfil.ubicacion.direccion).toBeNull();
    expect(perfil.ubicacion.mapsUrl).toBeNull();
  });

  it('12. las referencias visuales de A no aparecen en B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA } = await sembrar();

    const { token } = await login('super-a@test.local', SLUG_A);

    const banner = `/uploads/negocios/${negocioA.id}/perfil/banner.png`;

    await request(app.getHttpServer())
      .put('/perfil-negocio/referencias')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ bannerUrl: banner });

    const enB = await request(app.getHttpServer())
      .get('/perfil-negocio')
      .set('X-Negocio-Slug', SLUG_B);

    expect(enB.status).toBe(200);
    expect(cuerpo<PerfilPublico>(enB).bannerUrl).toBeNull();

    const enA = await request(app.getHttpServer())
      .get('/perfil-negocio')
      .set('X-Negocio-Slug', SLUG_A);

    expect(cuerpo<PerfilPublico>(enA).bannerUrl).toBe(banner);
  });

  it('13. el cuerpo no puede forzar un negocioId', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioB } = await sembrar();

    const { token } = await login('super-a@test.local', SLUG_A);

    const respuesta = await request(app.getHttpServer())
      .put('/perfil-negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ frasePrincipal: 'Intento', negocioId: negocioB.id });

    expect(respuesta.status).toBe(400);
  });

  it('14. la referencia de archivo debe ser una ruta o una URL http/https', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const { token } = await login('super-a@test.local', SLUG_A);

    const respuesta = await request(app.getHttpServer())
      .put('/perfil-negocio/referencias')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ bannerUrl: 'javascript:alert(1)' });

    expect(respuesta.status).toBe(400);
  });
});

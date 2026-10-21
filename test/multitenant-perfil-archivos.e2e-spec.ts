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
import * as express from 'express';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { AuthModule } from '../src/auth/auth.module';
import { GoogleTokenVerifier } from '../src/auth/google/google-token-verifier.service';
import { NegocioContextoMiddleware } from '../src/modules/negocios/middleware/negocio-contexto.middleware';
import { NegociosModule } from '../src/modules/negocios/negocios.module';
import { PerfilNegocioModule } from '../src/modules/perfil-negocio/perfil-negocio.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import {
  cabecerasSeguridadUploads,
  directorioUploads,
} from '../src/common/config/uploads.config';

/**
 * ALMACENAMIENTO DE LOS RECURSOS DE MARCA POR NEGOCIO CONTRA MYSQL 8.0 REAL
 * (Fase 15).
 *
 * Levanta un contenedor **MySQL 8.0.46 efímero**, aplica las migraciones
 * REALES y monta la aplicación con el módulo de perfil, los guards y el
 * middleware de contexto REALES. Solo se sustituye la verificación
 * criptográfica de Google.
 *
 * Los archivos se escriben en un directorio temporal real (`UPLOADS_DIR`), y
 * se sirven con el MISMO middleware estático que usa `main.ts`, de modo que
 * se comprueba también el tipo MIME con el que se publican.
 *
 * Escenarios:
 *  1. Sube los cuatro recursos admitidos (favicon, banner y dos logos).
 *  2. Rechaza un tipo de archivo inválido.
 *  3. Rechaza un SVG malicioso.
 *  4. Rechaza un archivo demasiado grande.
 *  5. Aisla los archivos entre las dos barberías.
 *  6. Un administrador de A no puede tocar los recursos de B.
 *  7. Reemplazar un recurso no altera los demás.
 *  8. Si falla la escritura, no queda una referencia rota.
 *  9. El perfil público solo expone los recursos del negocio actual.
 * 10. Eliminar un recurso borra la referencia y el archivo.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const SECRETO_PERSONAL = 'secreto-personal-fase15-e2e';

const SLUG_A = 'negocio-a';
const SLUG_B = 'negocio-b';

/** SVG válido y mínimo. */
const SVG_VALIDO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
  '<path d="M4 4h16v16H4z" fill="#0C0C0C"/></svg>';

/** SVG con un script: no puede almacenarse. */
const SVG_MALICIOSO =
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect x="1"/></svg>';

/** PNG mínimo válido (firma + IHDR). */
const PNG_VALIDO = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.from([0x00, 0x00, 0x00, 0x01]),
]);

/** Cuerpo de la respuesta de gestión del perfil. */
interface PerfilGestion {
  configurado: boolean;
  referenciasArchivo: {
    faviconUrl: string | null;
    bannerUrl: string | null;
    logoBlancoUrl: string | null;
    logoNegroUrl: string | null;
  };
}

/** Cuerpo de la vista pública del perfil. */
interface PerfilPublico {
  faviconUrl: string | null;
  bannerUrl: string | null;
  logoBlancoUrl: string | null;
  logoNegroUrl: string | null;
}

/** Cuerpo de la respuesta de inicio de sesión. */
interface SesionEmitida {
  accessToken?: string;
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
    PerfilNegocioModule,
  ],
})
class PruebaArchivosModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Almacenamiento de recursos de marca por negocio (MySQL 8.0 real)', () => {
  let conexion: MariaDbConnection | undefined;
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let directorioTemporal: string;
  let uploadsOriginal: string | undefined;

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

    // El almacenamiento real de los archivos: un directorio temporal.
    directorioTemporal = fs.mkdtempSync(
      path.join(os.tmpdir(), 'barberia-uploads-'),
    );
    uploadsOriginal = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = directorioTemporal;

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
      imports: [PruebaArchivosModule],
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

    // Mismo middleware estático que usa `main.ts`.
    app.use(
      '/uploads',
      express.static(directorioUploads(), {
        setHeaders: (res) => {
          for (const [cabecera, valor] of Object.entries(
            cabecerasSeguridadUploads(),
          )) {
            res.setHeader(cabecera, valor);
          }
        },
      }),
    );

    await app.init();
  }, 300000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();

    if (directorioTemporal) {
      fs.rmSync(directorioTemporal, { recursive: true, force: true });
    }

    if (uploadsOriginal === undefined) {
      delete process.env.UPLOADS_DIR;
    } else {
      process.env.UPLOADS_DIR = uploadsOriginal;
    }
  });

  /** Crea los dos negocios y un administrador en cada uno. */
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

    const adminA = await crearUsuario('admin-a@test.local');
    const adminB = await crearUsuario('admin-b@test.local');

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

    return { negocioA, negocioB };
  };

  /** Inicia sesión y devuelve el token del negocio. */
  const login = async (
    correo: string,
    slug: string,
  ): Promise<string | undefined> => {
    const respuesta = await request(app.getHttpServer())
      .post('/auth/google')
      .set('X-Negocio-Slug', slug)
      .send({ idToken: correo });

    return cuerpo<SesionEmitida>(respuesta).accessToken;
  };

  /** Sube un recurso al perfil del negocio indicado. */
  const subir = (
    token: string,
    slug: string,
    recurso: string,
    contenido: Buffer,
    nombre: string,
    tipo: string,
  ) =>
    request(app.getHttpServer())
      .post(`/perfil-negocio/${recurso}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', slug)
      .attach('archivo', contenido, { filename: nombre, contentType: tipo });

  it('1. sube los cuatro recursos admitidos y los publica con su MIME', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    const favicon = await subir(
      token!,
      SLUG_A,
      'favicon',
      Buffer.from(SVG_VALIDO, 'utf8'),
      'favicon.svg',
      'image/svg+xml',
    );
    expect(favicon.status).toBe(201);

    const banner = await subir(
      token!,
      SLUG_A,
      'banner',
      PNG_VALIDO,
      'banner.png',
      'image/png',
    );
    expect(banner.status).toBe(201);

    const logoBlanco = await subir(
      token!,
      SLUG_A,
      'logo-blanco',
      Buffer.from(SVG_VALIDO, 'utf8'),
      'logo-blanco.svg',
      'image/svg+xml',
    );
    expect(logoBlanco.status).toBe(201);

    const logoNegro = await subir(
      token!,
      SLUG_A,
      'logo-negro',
      Buffer.from(SVG_VALIDO, 'utf8'),
      'logo-negro.svg',
      'image/svg+xml',
    );
    expect(logoNegro.status).toBe(201);

    const perfil = cuerpo<PerfilGestion>(favicon);
    const gestion = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Negocio-Slug', SLUG_A),
    );

    expect(gestion.referenciasArchivo.faviconUrl).toContain(
      '/uploads/negocios/',
    );
    expect(gestion.referenciasArchivo.bannerUrl).toContain(
      '/uploads/negocios/',
    );
    expect(gestion.referenciasArchivo.logoBlancoUrl).toContain(
      '/uploads/negocios/',
    );
    expect(gestion.referenciasArchivo.logoNegroUrl).toContain(
      '/uploads/negocios/',
    );
    expect(perfil.configurado).toBe(true);

    // El archivo existe en disco y se sirve con el tipo MIME correcto.
    const rutaFavicon = path.join(
      directorioUploads(),
      gestion.referenciasArchivo.faviconUrl!.replace('/uploads/', ''),
    );
    expect(fs.existsSync(rutaFavicon)).toBe(true);

    const servido = await request(app.getHttpServer()).get(
      gestion.referenciasArchivo.faviconUrl!,
    );
    expect(servido.status).toBe(200);
    expect(servido.headers['content-type']).toContain('image/svg+xml');
    expect(servido.headers['x-content-type-options']).toBe('nosniff');
    expect(servido.headers['content-security-policy']).toContain('sandbox');

    // El contenido publicado es el SVG saneado (sin script).
    const publicado = Buffer.isBuffer(servido.body)
      ? servido.body.toString('utf8')
      : String(servido.text ?? '');
    expect(publicado).toContain('<svg');
    expect(publicado).not.toContain('script');
  });

  it('2. rechaza un tipo de archivo inválido', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    // Un PNG no es un favicon.
    const pngEnFavicon = await subir(
      token!,
      SLUG_A,
      'favicon',
      PNG_VALIDO,
      'favicon.png',
      'image/png',
    );
    expect(pngEnFavicon.status).toBe(400);

    // Un SVG no es un banner.
    const svgEnBanner = await subir(
      token!,
      SLUG_A,
      'banner',
      Buffer.from(SVG_VALIDO, 'utf8'),
      'banner.svg',
      'image/svg+xml',
    );
    expect(svgEnBanner.status).toBe(400);

    // HTML con la extension .svg: el contenido real manda.
    const htmlEnFavicon = await subir(
      token!,
      SLUG_A,
      'favicon',
      Buffer.from('<html><script>alert(1)</script></html>', 'utf8'),
      'favicon.svg',
      'image/svg+xml',
    );
    expect(htmlEnFavicon.status).toBe(400);
  });

  it('3. rechaza un SVG malicioso', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    // Referencia vigente antes del intento (puede venir de otra prueba).
    const antes = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Negocio-Slug', SLUG_A),
    );

    const respuesta = await subir(
      token!,
      SLUG_A,
      'favicon',
      Buffer.from(SVG_MALICIOSO, 'utf8'),
      'favicon.svg',
      'image/svg+xml',
    );

    expect(respuesta.status).toBe(400);

    // La referencia NO cambia: el archivo malicioso no se guarda.
    const despues = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Negocio-Slug', SLUG_A),
    );

    expect(despues.referenciasArchivo.faviconUrl).toBe(
      antes.referenciasArchivo.faviconUrl,
    );
  });

  it('4. rechaza un archivo demasiado grande', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    const grande = Buffer.concat([
      Buffer.from(SVG_VALIDO, 'utf8'),
      Buffer.alloc(300 * 1024, 0x20),
    ]);

    const respuesta = await subir(
      token!,
      SLUG_A,
      'favicon',
      grande,
      'favicon.svg',
      'image/svg+xml',
    );

    expect(respuesta.status).toBeGreaterThanOrEqual(400);
    expect(respuesta.status).toBeLessThan(500);
  });

  it('5. aísla los archivos entre las dos barberías', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA, negocioB } = await sembrar();

    const tokenA = await login('admin-a@test.local', SLUG_A);
    const tokenB = await login('admin-b@test.local', SLUG_B);

    await subir(
      tokenA!,
      SLUG_A,
      'banner',
      PNG_VALIDO,
      'banner.png',
      'image/png',
    );

    // El recurso de A vive en el espacio de A.
    const gestionA = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Negocio-Slug', SLUG_A),
    );
    expect(gestionA.referenciasArchivo.bannerUrl).toContain(
      `/negocios/${negocioA.id}/perfil/`,
    );

    // Y NO en el de B.
    const gestionB = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Negocio-Slug', SLUG_B),
    );
    expect(gestionB.referenciasArchivo.bannerUrl).toBeNull();

    // El fichero de A está en el directorio de A.
    const directorioA = path.join(
      directorioUploads(),
      'negocios',
      String(negocioA.id),
      'perfil',
    );
    expect(fs.readdirSync(directorioA).length).toBeGreaterThan(0);

    const directorioB = path.join(
      directorioUploads(),
      'negocios',
      String(negocioB.id),
      'perfil',
    );
    expect(
      fs.existsSync(directorioB) ? fs.readdirSync(directorioB) : [],
    ).toHaveLength(0);
  });

  it('6. un administrador de A no puede tocar los recursos de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioB } = await sembrar();

    const tokenA = await login('admin-a@test.local', SLUG_A);
    const tokenB = await login('admin-b@test.local', SLUG_B);

    // B sube su banner.
    await subir(
      tokenB!,
      SLUG_B,
      'banner',
      PNG_VALIDO,
      'banner.png',
      'image/png',
    );

    const gestionB = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Negocio-Slug', SLUG_B),
    );
    const referenciaDeB = gestionB.referenciasArchivo.bannerUrl!;

    // A no puede apuntar su perfil al recurso de B.
    const intento = await request(app.getHttpServer())
      .put('/perfil-negocio/referencias')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ bannerUrl: referenciaDeB });

    expect(intento.status).toBe(400);

    // Y tampoco puede borrarlo: la eliminación va contra su propio negocio.
    const borrado = await request(app.getHttpServer())
      .delete('/perfil-negocio/banner')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Negocio-Slug', SLUG_A);

    expect(borrado.status).toBe(200);

    const trasBorrado = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Negocio-Slug', SLUG_B),
    );
    expect(trasBorrado.referenciasArchivo.bannerUrl).toBe(referenciaDeB);
    expect(referenciaDeB).toContain(`/negocios/${negocioB.id}/perfil/`);
  });

  it('7. reemplazar un recurso no altera los demás', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    await subir(
      token!,
      SLUG_A,
      'favicon',
      Buffer.from(SVG_VALIDO, 'utf8'),
      'favicon.svg',
      'image/svg+xml',
    );
    await subir(
      token!,
      SLUG_A,
      'banner',
      PNG_VALIDO,
      'banner.png',
      'image/png',
    );

    const antes = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Negocio-Slug', SLUG_A),
    );

    // Se reemplaza el favicon.
    await subir(
      token!,
      SLUG_A,
      'favicon',
      Buffer.from(SVG_VALIDO.replace('#0C0C0C', '#0071BC'), 'utf8'),
      'otro.svg',
      'image/svg+xml',
    );

    const despues = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Negocio-Slug', SLUG_A),
    );

    // El banner NO ha cambiado.
    expect(despues.referenciasArchivo.bannerUrl).toBe(
      antes.referenciasArchivo.bannerUrl,
    );
    // Y el favicon sí.
    expect(despues.referenciasArchivo.faviconUrl).not.toBe(
      antes.referenciasArchivo.faviconUrl,
    );
  });

  it('8. si falla la escritura no queda una referencia rota', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    // Referencia vigente antes del intento.
    const antes = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Negocio-Slug', SLUG_A),
    );

    // Un destino de almacenamiento IMPOSIBLE de crear: la escritura del
    // archivo falla antes de tocar la base de datos.
    const bloqueo = path.join(directorioTemporal, 'bloqueado');
    fs.writeFileSync(bloqueo, 'esto es un fichero, no un directorio');

    const original = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = path.join(bloqueo, 'subida');

    const respuesta = await subir(
      token!,
      SLUG_A,
      'favicon',
      Buffer.from(SVG_VALIDO, 'utf8'),
      'favicon.svg',
      'image/svg+xml',
    );

    process.env.UPLOADS_DIR = original;

    expect(respuesta.status).toBeGreaterThanOrEqual(400);

    // El perfil conserva la referencia anterior: no queda una referencia rota.
    const despues = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Negocio-Slug', SLUG_A),
    );
    expect(despues.referenciasArchivo.faviconUrl).toBe(
      antes.referenciasArchivo.faviconUrl,
    );
  });

  it('9. el perfil público solo expone los recursos del negocio actual', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA, negocioB } = await sembrar();
    const tokenA = await login('admin-a@test.local', SLUG_A);
    const tokenB = await login('admin-b@test.local', SLUG_B);

    await subir(
      tokenA!,
      SLUG_A,
      'banner',
      PNG_VALIDO,
      'banner.png',
      'image/png',
    );
    await subir(
      tokenB!,
      SLUG_B,
      'logo-blanco',
      Buffer.from(SVG_VALIDO, 'utf8'),
      'logo-blanco.svg',
      'image/svg+xml',
    );

    const publicoA = cuerpo<PerfilPublico>(
      await request(app.getHttpServer())
        .get('/perfil-negocio')
        .set('X-Negocio-Slug', SLUG_A),
    );
    const publicoB = cuerpo<PerfilPublico>(
      await request(app.getHttpServer())
        .get('/perfil-negocio')
        .set('X-Negocio-Slug', SLUG_B),
    );

    // Cada barbería ve SOLO sus propios recursos.
    expect(publicoA.bannerUrl).toContain(`/negocios/${negocioA.id}/perfil/`);
    expect(publicoA.logoBlancoUrl).not.toContain(
      `/negocios/${negocioB.id}/perfil/`,
    );

    expect(publicoB.logoBlancoUrl).toContain(
      `/negocios/${negocioB.id}/perfil/`,
    );
    expect(publicoB.bannerUrl).not.toContain(
      `/negocios/${negocioA.id}/perfil/`,
    );
  });

  it('10. eliminar un recurso borra la referencia y el archivo', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    await subir(
      token!,
      SLUG_A,
      'banner',
      PNG_VALIDO,
      'banner.png',
      'image/png',
    );

    const antes = cuerpo<PerfilGestion>(
      await request(app.getHttpServer())
        .get('/perfil-negocio/gestion')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Negocio-Slug', SLUG_A),
    );
    const referencia = antes.referenciasArchivo.bannerUrl!;

    const borrado = await request(app.getHttpServer())
      .delete('/perfil-negocio/banner')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A);
    expect(borrado.status).toBe(200);

    const despues = cuerpo<PerfilGestion>(borrado);
    expect(despues.referenciasArchivo.bannerUrl).toBeNull();

    const ruta = path.join(
      directorioUploads(),
      referencia.replace('/uploads/', ''),
    );
    expect(fs.existsSync(ruta)).toBe(false);

    // Y el espacio del negocio sigue existiendo (no se borra el directorio).
    expect(
      fs.existsSync(
        path.join(
          directorioUploads(),
          'negocios',
          String(negocioA.id),
          'perfil',
        ),
      ),
    ).toBe(true);
  });
});

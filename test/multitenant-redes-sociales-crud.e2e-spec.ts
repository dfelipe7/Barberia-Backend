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
import { TipoRedSocial } from '../generated/prisma/enums';
import { AuthModule } from '../src/auth/auth.module';
import { GoogleTokenVerifier } from '../src/auth/google/google-token-verifier.service';
import { NegocioContextoMiddleware } from '../src/modules/negocios/middleware/negocio-contexto.middleware';
import { NegociosModule } from '../src/modules/negocios/negocios.module';
import { PerfilNegocioModule } from '../src/modules/perfil-negocio/perfil-negocio.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { RedSocialResponseDto } from '../src/modules/perfil-negocio/dto/dto-respuesta/red-social.response.dto';

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';
const SECRETO_PERSONAL = 'secreto-personal-redes-crud-e2e';
const SLUG_A = 'negocio-a';
const SLUG_B = 'negocio-b';

function cuerpo<T>(respuesta: Response): T {
  return (respuesta.body ?? {}) as T;
}

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
class PruebaRedesCrudModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Redes sociales CRUD y Reactivación (Fase 18 - E2E)', () => {
  let conexion: MariaDbConnection | undefined;
  let app: INestApplication<App>;
  let prisma: PrismaClient;

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

    try {
      conexion = await MariaDbConnection.start({
        motor: 'mysql',
        lowerCaseTableNames: false,
      });
    } catch {
      return;
    }

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
      imports: [PruebaRedesCrudModule],
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
  }, 300000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();
  });

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
    const superB = await crearUsuario('super-b@test.local');

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
        negocioId_usuarioId: { negocioId: negocioB.id, usuarioId: superB.id },
      },
      update: { superadmin: true },
      create: {
        usuarioId: superB.id,
        negocioId: negocioB.id,
        superadmin: true,
      },
    });

    await prisma.redSocialNegocio.deleteMany({
      where: { negocioId: { in: [negocioA.id, negocioB.id] } },
    });

    return { negocioA, negocioB };
  };

  const login = async (
    email: string,
    slug: string,
  ): Promise<{ token: string }> => {
    const res = await request(app.getHttpServer())
      .post('/auth/google/personal')
      .set('X-Negocio-Slug', slug)
      .send({ idToken: email });

    const datos = cuerpo<SesionEmitida>(res);
    return { token: datos.accessToken ?? '' };
  };

  it('1. PATCH cambia url y persiste en BD', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const red = await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioA.id,
        tipo: TipoRedSocial.INSTAGRAM,
        nombre: 'Instagram',
        url: 'https://instagram.com/antiguo',
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/perfil-negocio/redes-sociales/${red.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ url: 'https://instagram.com/nuevo' });

    expect(res.status).toBe(200);
    expect(cuerpo<RedSocialResponseDto>(res).url).toBe(
      'https://instagram.com/nuevo',
    );

    const enBd = await prisma.redSocialNegocio.findUnique({
      where: { id: red.id },
    });
    expect(enBd?.url).toBe('https://instagram.com/nuevo');
  });

  it('2. PATCH sobre red de otro negocio → 404 (uniforme)', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioB } = await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const redB = await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioB.id,
        tipo: TipoRedSocial.TIKTOK,
        nombre: 'TikTok',
        url: 'https://tiktok.com/@b',
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/perfil-negocio/redes-sociales/${redB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ url: 'https://tiktok.com/@hack' });

    expect(res.status).toBe(404);
  });

  it('3. DELETE desactiva y GET /perfil-negocio/redes-sociales ya no la muestra', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const red = await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioA.id,
        tipo: TipoRedSocial.FACEBOOK,
        nombre: 'Facebook',
        url: 'https://facebook.com/a',
      },
    });

    const resDelete = await request(app.getHttpServer())
      .delete(`/perfil-negocio/redes-sociales/${red.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A);

    expect(resDelete.status).toBe(200);
    expect(cuerpo<RedSocialResponseDto>(resDelete).activo).toBe(false);

    const resListar = await request(app.getHttpServer())
      .get('/perfil-negocio/redes-sociales')
      .set('X-Negocio-Slug', SLUG_A);

    expect(resListar.status).toBe(200);
    expect(cuerpo<RedSocialResponseDto[]>(resListar)).toHaveLength(0);
  });

  it('4. DELETE dos veces → 200 idempotente, activo: false', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const red = await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioA.id,
        tipo: TipoRedSocial.WHATSAPP,
        nombre: 'WhatsApp',
        url: 'https://wa.me/123456',
        activo: false,
      },
    });

    const res = await request(app.getHttpServer())
      .delete(`/perfil-negocio/redes-sociales/${red.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A);

    expect(res.status).toBe(200);
    expect(cuerpo<RedSocialResponseDto>(res).activo).toBe(false);
  });

  it('5. PATCH /activar reactiva y GET /perfil-negocio/redes-sociales la vuelve a mostrar', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const red = await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioA.id,
        tipo: TipoRedSocial.INSTAGRAM,
        nombre: 'Instagram',
        url: 'https://instagram.com/kyrios',
        activo: false,
      },
    });

    const resActivar = await request(app.getHttpServer())
      .patch(`/perfil-negocio/redes-sociales/${red.id}/activar`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A);

    expect(resActivar.status).toBe(200);
    expect(cuerpo<RedSocialResponseDto>(resActivar).activo).toBe(true);

    const resListar = await request(app.getHttpServer())
      .get('/perfil-negocio/redes-sociales')
      .set('X-Negocio-Slug', SLUG_A);

    expect(resListar.status).toBe(200);
    expect(cuerpo<RedSocialResponseDto[]>(resListar)).toHaveLength(1);
  });

  it('6. PATCH /activar sobre una red de otro negocio → 404', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioB } = await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const redB = await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioB.id,
        tipo: TipoRedSocial.TIKTOK,
        nombre: 'TikTok',
        url: 'https://tiktok.com/@b',
        activo: false,
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/perfil-negocio/redes-sociales/${redB.id}/activar`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A);

    expect(res.status).toBe(404);
  });

  it('7. PUT bulk con una red desactivada por DELETE y mismo (tipo, nombre) → la reactiva con el mismo id', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const red = await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioA.id,
        tipo: TipoRedSocial.INSTAGRAM,
        nombre: 'Instagram',
        url: 'https://instagram.com/viejo',
        activo: false,
      },
    });

    const res = await request(app.getHttpServer())
      .put('/perfil-negocio/redes-sociales')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send([
        {
          tipo: TipoRedSocial.INSTAGRAM,
          url: 'https://instagram.com/renovado',
          orden: 1,
        },
      ]);

    expect(res.status).toBe(200);
    const lista = cuerpo<RedSocialResponseDto[]>(res);
    expect(lista).toHaveLength(1);
    expect(lista[0].id).toBe(red.id);
    expect(lista[0].url).toBe('https://instagram.com/renovado');
    expect(lista[0].activo).toBe(true);
  });

  it('8. PATCH /activar con colisión (dos OTRO del mismo nombre, una activa y otra desactivada) → 409', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioA.id,
        tipo: TipoRedSocial.OTRO,
        nombre: 'Canal Único',
        url: 'https://canal.com/1',
        activo: true,
      },
    });

    const redInactiva = await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioA.id,
        tipo: TipoRedSocial.OTRO,
        nombre: 'Canal Antiguo',
        url: 'https://canal.com/2',
        activo: false,
      },
    });

    // Cambiamos el nombre de la inactiva en BD directamente para simular colisión potencial
    await prisma.redSocialNegocio.update({
      where: { id: redInactiva.id },
      data: { nombre: 'Canal Único' },
    });

    const res = await request(app.getHttpServer())
      .patch(`/perfil-negocio/redes-sociales/${redInactiva.id}/activar`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A);

    expect(res.status).toBe(409);
  });

  it('9. PATCH intenta cambiar tipo → 400', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const red = await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioA.id,
        tipo: TipoRedSocial.INSTAGRAM,
        nombre: 'Instagram',
        url: 'https://instagram.com/test',
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/perfil-negocio/redes-sociales/${red.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ tipo: 'TIKTOK' });

    expect(res.status).toBe(400);
  });

  it('10. PATCH intenta cambiar activo → 400', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const red = await prisma.redSocialNegocio.create({
      data: {
        negocioId: negocioA.id,
        tipo: TipoRedSocial.INSTAGRAM,
        nombre: 'Instagram',
        url: 'https://instagram.com/test',
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/perfil-negocio/redes-sociales/${red.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send({ activo: false });

    expect(res.status).toBe(400);
  });
});

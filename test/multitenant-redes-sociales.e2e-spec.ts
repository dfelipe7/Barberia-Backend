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
const SECRETO_PERSONAL = 'secreto-personal-redes-sociales-e2e';
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
class PruebaRedesModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Redes sociales por negocio (Fase 18 - E2E)', () => {
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
      imports: [PruebaRedesModule],
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

  it('1. la consulta pública sin contexto de negocio se rechaza', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const res = await request(app.getHttpServer()).get(
      '/perfil-negocio/redes-sociales',
    );
    expect(res.status).toBe(403);
  });

  it('2. un negocio sin redes sociales responde 200 con lista vacía', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();

    const res = await request(app.getHttpServer())
      .get('/perfil-negocio/redes-sociales')
      .set('X-Negocio-Slug', SLUG_A);

    expect(res.status).toBe(200);
    expect(cuerpo<RedSocialResponseDto[]>(res)).toEqual([]);
  });

  it('3. SUPERADMIN de A puede configurar redes sociales en A', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const res = await request(app.getHttpServer())
      .put('/perfil-negocio/redes-sociales')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send([
        {
          tipo: TipoRedSocial.INSTAGRAM,
          url: 'https://instagram.com/a',
          orden: 1,
        },
        {
          tipo: TipoRedSocial.OTRO,
          nombre: 'Blog Oficial',
          url: 'https://blog.com',
          orden: 2,
        },
      ]);

    expect(res.status).toBe(200);
    const lista = cuerpo<RedSocialResponseDto[]>(res);
    expect(lista).toHaveLength(2);
    expect(lista[0].nombre).toBe('Instagram');
    expect(lista[1].nombre).toBe('Blog Oficial');
  });

  it('4. las redes sociales de A no son visibles desde el contexto de B', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    await request(app.getHttpServer())
      .put('/perfil-negocio/redes-sociales')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send([
        {
          tipo: TipoRedSocial.FACEBOOK,
          url: 'https://facebook.com/a',
          orden: 1,
        },
      ]);

    const resB = await request(app.getHttpServer())
      .get('/perfil-negocio/redes-sociales')
      .set('X-Negocio-Slug', SLUG_B);

    expect(resB.status).toBe(200);
    expect(cuerpo<RedSocialResponseDto[]>(resB)).toEqual([]);
  });

  it('5. tipo OTRO sin nombre es rechazado con 400', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const res = await request(app.getHttpServer())
      .put('/perfil-negocio/redes-sociales')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send([{ tipo: TipoRedSocial.OTRO, url: 'https://blog.com', orden: 1 }]);

    expect(res.status).toBe(400);
  });

  it('6. URLs sin protocolo HTTPS son rechazadas con 400', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();
    const { token } = await login('super-a@test.local', SLUG_A);

    const res = await request(app.getHttpServer())
      .put('/perfil-negocio/redes-sociales')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', SLUG_A)
      .send([
        { tipo: TipoRedSocial.INSTAGRAM, url: 'http://inseguro.com', orden: 1 },
      ]);

    expect(res.status).toBe(400);
  });
});

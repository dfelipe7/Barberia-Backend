import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { AuthModule } from '../src/auth/auth.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/roles/roles.guard';
import { Roles } from '../src/auth/roles/roles.decorator';
import { GoogleTokenVerifier } from '../src/auth/google/google-token-verifier.service';
import { ClienteJwtService } from '../src/auth/clientes/cliente-jwt.service';
import { ClienteJwtAuthGuard } from '../src/auth/clientes/guards/cliente-jwt-auth.guard';
import { PersonalJwtService } from '../src/auth/sesion/personal-jwt.service';
import { NegocioContextoMiddleware } from '../src/modules/negocios/middleware/negocio-contexto.middleware';
import { NegociosModule } from '../src/modules/negocios/negocios.module';
import { PrismaModule } from '../src/prisma/prisma.module';

/**
 * PRUEBA DE AUTENTICACIÓN Y AUTORIZACIÓN POR NEGOCIO (Fase 4) CONTRA
 * MARIADB REAL.
 *
 * Levanta un contenedor **MariaDB 11 efímero**, aplica las migraciones REALES
 * del proyecto y monta una aplicación Nest con el módulo de autenticación
 * real (los mismos guards, servicios y repositorios que en producción). Solo
 * se sustituye la verificación criptográfica de Google por un simulador: lo
 * que se comprueba es la emisión de tokens, el vínculo con la barbería y la
 * autorización por roles EFECTIVOS.
 *
 * Escenarios:
 *  1. El login del personal emite un token con los roles del negocio.
 *  2. El login sin contexto de barbería se rechaza.
 *  3. El login de quien no tiene perfil activo en la barbería se rechaza.
 *  4. El SUPERADMIN recibe una sesión global de plataforma (sin negocio).
 *  5. El token de una barbería no opera en otra.
 *  6. El cambio explícito de negocio emite un token del negocio de destino.
 *  7. El cambio explícito a una barbería sin pertenencia se rechaza.
 *  8. El cambio explícito a una barbería inexistente se rechaza.
 *  9. La sesión de plataforma no habilita las rutas de negocio.
 * 10. El refresh renueva la sesión con los roles recalculados.
 * 11. Un barbero no entra en una ruta de administrador.
 * 12. Un token de cliente no vale en las rutas de personal.
 * 13. La sesión de cliente queda atada a su barbería.
 * 14. Los tokens de personal y de cliente llevan marcas y secretos distintos.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const SECRETO_PERSONAL = 'secreto-personal-fase4-e2e';
const SECRETO_CLIENTE = 'secreto-cliente-fase4-e2e';

/** Rutas de prueba protegidas con los guards reales. */
@Controller('prueba')
class PruebaController {
  @Get('negocio')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRADOR', 'BARBERO', 'SUPERADMIN')
  negocio(@Req() req: any) {
    return {
      negocioId: req.user.negocioId,
      roles: req.user.roles,
      superadmin: req.user.superadmin,
    };
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRADOR')
  admin(@Req() req: any) {
    return { roles: req.user.roles };
  }

  @Get('cliente')
  @UseGuards(ClienteJwtAuthGuard)
  cliente(@Req() req: any) {
    return { clienteId: req.cliente.clienteId, negocioId: req.cliente.negocioId };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    NegociosModule,
    PrismaModule,
  ],
  controllers: [PruebaController],
  providers: [ClienteJwtService, ClienteJwtAuthGuard],
})
class PruebaModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Autenticación y autorización por negocio (MariaDB real)', () => {
  let conexion: MariaDbConnection | undefined;
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  /** Token de Google simulado: el "idToken" es el correo del usuario. */
  const verificarGoogle = jest.fn(async (idToken: string) => ({
    sub: `sub-${idToken}`,
    email: idToken,
    email_verified: true,
    given_name: 'Persona',
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
    process.env.JWT_SECRET = SECRETO_PERSONAL;
    process.env.JWT_CLIENTE_SECRET = SECRETO_CLIENTE;
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
      imports: [PruebaModule],
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
   * Crea los dos negocios y las personas de prueba.
   *
   * `cross` es la persona que tiene perfil en AMBAS barberías: administrador
   * en A y barbero en B. Es el caso que permite el cambio explícito de
   * negocio: `Administrador.usuarioId` y `Barbero.usuarioId` son únicos, pero
   * son tablas DISTINTAS.
   */
  const sembrar = async () => {
    const negocioA = await prisma.negocio.upsert({
      where: { slug: 'negocio-a' },
      update: {},
      create: { slug: 'negocio-a', nombre: 'Negocio A' },
    });
    const negocioB = await prisma.negocio.upsert({
      where: { slug: 'negocio-b' },
      update: {},
      create: { slug: 'negocio-b', nombre: 'Negocio B' },
    });

    const crearUsuario = async (email: string, rol: string) =>
      prisma.usuario.upsert({
        where: { email },
        update: {},
        create: {
          email,
          nombre: 'Persona',
          apellido: email,
          rol: rol as any,
        },
      });

    const adminA = await crearUsuario('admin-a@test.local', 'PERSONAL');
    const barberoA = await crearUsuario('barbero-a@test.local', 'PERSONAL');
    const cross = await crearUsuario('cross@test.local', 'PERSONAL');
    const superadmin = await crearUsuario('super@test.local', 'SUPERADMIN');
    const sinPerfil = await crearUsuario('sinperfil@test.local', 'PERSONAL');

    await prisma.administrador.upsert({
      where: { negocioId_usuarioId: { negocioId: negocioA.id, usuarioId: adminA.id } },
      update: {},
      create: { usuarioId: adminA.id, negocioId: negocioA.id },
    });
    await prisma.administrador.upsert({
      where: { negocioId_usuarioId: { negocioId: negocioA.id, usuarioId: cross.id } },
      update: {},
      create: { usuarioId: cross.id, negocioId: negocioA.id },
    });
    await prisma.barbero.upsert({
      where: { negocioId_usuarioId: { negocioId: negocioA.id, usuarioId: barberoA.id } },
      update: {},
      create: {
        usuarioId: barberoA.id,
        telefono: '300',
        porcentajeComision: 10,
        negocioId: negocioA.id,
      },
    });
    await prisma.barbero.upsert({
      where: { negocioId_usuarioId: { negocioId: negocioB.id, usuarioId: cross.id } },
      update: {},
      create: {
        usuarioId: cross.id,
        telefono: '301',
        porcentajeComision: 10,
        negocioId: negocioB.id,
      },
    });

    return { negocioA, negocioB, adminA, barberoA, cross, superadmin, sinPerfil };
  };

  const login = async (correo: string, slug?: string) => {
    const peticion = request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: correo });

    if (slug) {
      peticion.set('X-Negocio-Slug', slug);
    }

    return peticion;
  };

  it('1. el login del personal emite un token con los roles EFECTIVOS del negocio', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA } = await sembrar();

    const respuesta = await login('admin-a@test.local', 'negocio-a');

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.negocio).toEqual({
      id: negocioA.id,
      slug: 'negocio-a',
    });
    expect(respuesta.body.usuario.roles).toEqual(['ADMINISTRADOR']);
  });

  it('2. el login sin contexto de barbería se rechaza', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const respuesta = await login('admin-a@test.local');

    expect(respuesta.status).toBe(403);
  });

  it('3. el login de quien no tiene perfil activo en la barbería se rechaza', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const respuesta = await login('sinperfil@test.local', 'negocio-a');

    expect(respuesta.status).toBe(403);
  });

  it('4. el SUPERADMIN recibe una sesión global de plataforma', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const respuesta = await login('super@test.local', 'negocio-a');

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.negocio).toBeNull();
    expect(respuesta.body.usuario.roles).toEqual(['SUPERADMIN']);
  });

  it('5. el token de una barbería no opera en otra', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const loginA = await login('admin-a@test.local', 'negocio-a');
    const token = loginA.body.accessToken as string;

    const enSuBarberia = await request(app.getHttpServer())
      .get('/prueba/negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'negocio-a');

    expect(enSuBarberia.status).toBe(200);
    expect(enSuBarberia.body.roles).toEqual(['ADMINISTRADOR']);

    const enOtra = await request(app.getHttpServer())
      .get('/prueba/negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'negocio-b');

    expect(enOtra.status).toBe(403);
  });

  it('6. el cambio explícito de negocio emite un token del negocio de destino', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioB } = await sembrar();

    const loginA = await login('cross@test.local', 'negocio-a');
    const token = loginA.body.accessToken as string;

    const cambio = await request(app.getHttpServer())
      .post('/auth/tenant/negocio-b')
      .set('Authorization', `Bearer ${token}`);

    expect(cambio.status).toBe(201);
    expect(cambio.body.negocio).toEqual({
      id: negocioB.id,
      slug: 'negocio-b',
    });
    // Los roles se recalculan en el negocio de DESTINO.
    expect(cambio.body.usuario.roles).toEqual(['BARBERO']);

    // El token nuevo opera en B y no en A.
    const tokenNuevo = cambio.body.accessToken as string;

    const enDestino = await request(app.getHttpServer())
      .get('/prueba/negocio')
      .set('Authorization', `Bearer ${tokenNuevo}`)
      .set('X-Negocio-Slug', 'negocio-b');
    expect(enDestino.status).toBe(200);

    const enOrigen = await request(app.getHttpServer())
      .get('/prueba/negocio')
      .set('Authorization', `Bearer ${tokenNuevo}`)
      .set('X-Negocio-Slug', 'negocio-a');
    expect(enOrigen.status).toBe(403);
  });

  it('7. el cambio explícito a una barbería sin pertenencia se rechaza', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const loginA = await login('admin-a@test.local', 'negocio-a');
    const token = loginA.body.accessToken as string;

    const cambio = await request(app.getHttpServer())
      .post('/auth/tenant/negocio-b')
      .set('Authorization', `Bearer ${token}`);

    expect(cambio.status).toBe(403);
  });

  it('8. el cambio explícito a una barbería inexistente se rechaza', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const loginA = await login('admin-a@test.local', 'negocio-a');
    const token = loginA.body.accessToken as string;

    const cambio = await request(app.getHttpServer())
      .post('/auth/tenant/no-existe')
      .set('Authorization', `Bearer ${token}`);

    expect(cambio.status).toBe(403);
  });

  it('9. la sesión de plataforma no habilita las rutas de negocio', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const loginSuper = await login('super@test.local', 'negocio-a');
    const token = loginSuper.body.accessToken as string;

    const respuesta = await request(app.getHttpServer())
      .get('/prueba/negocio')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'negocio-a');

    expect(respuesta.status).toBe(401);
  });

  it('10. el refresh renueva la sesión con los roles recalculados', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const loginBarbero = await login('barbero-a@test.local', 'negocio-a');
    const token = loginBarbero.body.accessToken as string;

    const refresco = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(refresco.status).toBe(201);
    expect(refresco.body.usuario.roles).toEqual(['BARBERO']);
    expect(refresco.body.negocio.slug).toBe('negocio-a');
  });

  it('11. un barbero no entra en una ruta de administrador', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    const loginBarbero = await login('barbero-a@test.local', 'negocio-a');
    const token = loginBarbero.body.accessToken as string;

    const respuesta = await request(app.getHttpServer())
      .get('/prueba/admin')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Negocio-Slug', 'negocio-a');

    expect(respuesta.status).toBe(403);
  });

  it('12. un token de cliente no vale en las rutas de personal', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA } = await sembrar();

    const cliente = await prisma.cliente.create({
      data: { nombre: 'Cliente', negocioId: negocioA.id },
    });

    const clienteJwt = app.get(ClienteJwtService);
    const tokenCliente = clienteJwt.firmar({
      clienteId: cliente.id,
      email: null,
      nombre: 'Cliente',
      negocioId: negocioA.id,
    });

    const respuesta = await request(app.getHttpServer())
      .get('/prueba/negocio')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .set('X-Negocio-Slug', 'negocio-a');

    expect(respuesta.status).toBe(401);
  });

  it('13. la sesión de cliente queda atada a su barbería', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA } = await sembrar();

    const cliente = await prisma.cliente.create({
      data: { nombre: 'Cliente', negocioId: negocioA.id },
    });

    const clienteJwt = app.get(ClienteJwtService);
    const tokenCliente = clienteJwt.firmar({
      clienteId: cliente.id,
      email: null,
      nombre: 'Cliente',
      negocioId: negocioA.id,
    });

    const enSuBarberia = await request(app.getHttpServer())
      .get('/prueba/cliente')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .set('X-Negocio-Slug', 'negocio-a');

    expect(enSuBarberia.status).toBe(200);
    expect(enSuBarberia.body.negocioId).toBe(negocioA.id);

    const enOtra = await request(app.getHttpServer())
      .get('/prueba/cliente')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .set('X-Negocio-Slug', 'negocio-b');

    expect(enOtra.status).toBe(403);
  });

  it('14. los tokens de personal y de cliente llevan marcas y secretos distintos', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA } = await sembrar();

    const loginA = await login('admin-a@test.local', 'negocio-a');
    const tokenPersonal = loginA.body.accessToken as string;

    const cliente = await prisma.cliente.create({
      data: { nombre: 'Cliente', negocioId: negocioA.id },
    });
    const clienteJwt = app.get(ClienteJwtService);
    const tokenCliente = clienteJwt.firmar({
      clienteId: cliente.id,
      email: null,
      nombre: 'Cliente',
      negocioId: negocioA.id,
    });

    // El token de personal NO verifica con el secreto de cliente.
    await expect(clienteJwt.verificar(tokenPersonal)).rejects.toThrow();

    // Y el de cliente, con el de personal.
    const personalJwt = app.get(PersonalJwtService);
    await expect(personalJwt.verificar(tokenCliente)).rejects.toThrow();
  });
});

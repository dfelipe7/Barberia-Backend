import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
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
import { AuthModule } from '../src/auth/auth.module';
import { GoogleTokenVerifier } from '../src/auth/google/google-token-verifier.service';
import { NegocioContextoMiddleware } from '../src/modules/negocios/middleware/negocio-contexto.middleware';
import { NegociosModule } from '../src/modules/negocios/negocios.module';
import { ProductosModule } from '../src/modules/productos/productos.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { directorioUploads } from '../src/common/config/uploads.config';

/**
 * HE-03-HU-01 contra MySQL 8.0 REAL: registro de producto con imagen.
 *
 * Solo se sustituye la verificación criptográfica de Google. El resto de la
 * cadena (middleware de contexto, guards, DTOs, almacenamiento, Prisma) es la
 * real. Los archivos van a un `UPLOADS_DIR` temporal.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';
const SECRETO_PERSONAL = 'secreto-personal-productos-e2e';
const SLUG_A = 'negocio-a';
const SLUG_B = 'negocio-b';

const PNG_VALIDO = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.from([0x00, 0x00, 0x00, 0x01]),
]);

const SVG_NO_PERMITIDO =
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

interface SesionEmitida {
  accessToken?: string;
}

interface ProductoRegistrado {
  mensaje: string;
  producto: {
    id: number;
    nombre: string;
    descripcion?: string | null;
    precio: number;
    imagenUrl: string | null;
    estado: string;
    creadoEn?: string;
    actualizadoEn?: string;
  };
}

interface ProductosListado {
  mensaje?: string;
  productos: ProductoRegistrado['producto'][];
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
    ProductosModule,
  ],
})
class PruebaProductosModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Productos: registrar con imagen (MySQL 8.0 real)', () => {
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

    directorioTemporal = fs.mkdtempSync(
      path.join(os.tmpdir(), 'barberia-productos-'),
    );
    uploadsOriginal = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = directorioTemporal;

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
      imports: [PruebaProductosModule],
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

    if (directorioTemporal) {
      fs.rmSync(directorioTemporal, { recursive: true, force: true });
    }

    if (uploadsOriginal === undefined) {
      delete process.env.UPLOADS_DIR;
    } else {
      process.env.UPLOADS_DIR = uploadsOriginal;
    }
  });

  const directorioProductos = (negocioId: number) =>
    path.join(directorioUploads(), 'negocios', String(negocioId), 'productos');

  const archivosDe = (negocioId: number): string[] => {
    const directorio = directorioProductos(negocioId);
    return fs.existsSync(directorio) ? fs.readdirSync(directorio) : [];
  };

  /** Crea dos negocios, un administrador en cada uno, un SUPERADMIN en A y un barbero en A. */
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
    const superadminA = await crearUsuario('superadmin-a@test.local');
    const barberoA = await crearUsuario('barbero-a@test.local');

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

    await prisma.producto.deleteMany({
      where: { negocioId: { in: [negocioA.id, negocioB.id] } },
    });
    for (const negocio of [negocioA, negocioB]) {
      fs.rmSync(directorioProductos(negocio.id), {
        recursive: true,
        force: true,
      });
    }

    return { negocioA, negocioB };
  };

  const crearProducto = (
    negocioId: number,
    datos: {
      nombre: string;
      descripcion?: string | null;
      precio: number;
      imagenUrl?: string | null;
      estado?: 'ACTIVO' | 'INACTIVO';
    },
  ) =>
    prisma.producto.create({
      data: {
        negocioId,
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        precio: datos.precio,
        imagenUrl: datos.imagenUrl,
        estado: datos.estado ?? 'ACTIVO',
      },
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

  const registrar = (
    token: string | undefined,
    slug: string,
    campos: { nombre: string; precio: number | string; descripcion?: string },
    imagen?: { contenido: Buffer; nombre: string; tipo: string },
    extra?: Record<string, string>,
  ) => {
    let peticion = request(app.getHttpServer())
      .post('/productos')
      .set('X-Negocio-Slug', slug)
      .field('nombre', campos.nombre)
      .field('precio', String(campos.precio));

    if (token) {
      peticion = peticion.set('Authorization', `Bearer ${token}`);
    }

    if (campos.descripcion !== undefined) {
      peticion = peticion.field('descripcion', campos.descripcion);
    }

    for (const [campo, valor] of Object.entries(extra ?? {})) {
      peticion = peticion.field(campo, valor);
    }

    if (imagen) {
      peticion = peticion.attach('imagen', imagen.contenido, {
        filename: imagen.nombre,
        contentType: imagen.tipo,
      });
    }

    return peticion;
  };

  it('1. registra el producto con su imagen en el negocio del contexto', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await registrar(
      token,
      SLUG_A,
      {
        nombre: '  Cera mate  ',
        descripcion: '  Fijación fuerte  ',
        precio: '35000.50',
      },
      { contenido: PNG_VALIDO, nombre: 'producto.png', tipo: 'image/png' },
    );

    expect(respuesta.status).toBe(201);

    const datos = cuerpo<ProductoRegistrado>(respuesta);
    expect(datos.mensaje).toBe('Producto registrado correctamente');
    expect(datos.producto).toMatchObject({
      nombre: 'Cera mate',
      descripcion: 'Fijación fuerte',
      precio: 35000.5,
      estado: 'ACTIVO',
    });
    expect(datos.producto.imagenUrl).toContain(
      `/negocios/${negocioA.id}/productos/`,
    );

    const ruta = path.resolve(
      directorioUploads(),
      datos.producto.imagenUrl.replace('/uploads/', ''),
    );
    expect(fs.existsSync(ruta)).toBe(true);

    const enBase = await prisma.producto.findFirst({
      where: { negocioId: negocioA.id, nombre: 'Cera mate' },
    });
    expect(enBase).not.toBeNull();
    expect(enBase?.estado).toBe('ACTIVO');
    expect(Number(enBase?.precio)).toBe(35000.5);
  });

  it('2. el nombre es único por negocio, no entre negocios', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA, negocioB } = await sembrar();
    const tokenA = await login('admin-a@test.local', SLUG_A);
    const tokenB = await login('admin-b@test.local', SLUG_B);

    const primera = await registrar(
      tokenA,
      SLUG_A,
      { nombre: 'Cera mate', precio: 35000 },
      { contenido: PNG_VALIDO, nombre: 'producto.png', tipo: 'image/png' },
    );
    expect(primera.status).toBe(201);

    const archivosAntes = archivosDe(negocioA.id).length;

    const duplicada = await registrar(
      tokenA,
      SLUG_A,
      { nombre: 'Cera mate', precio: 40000 },
      { contenido: PNG_VALIDO, nombre: 'otra.png', tipo: 'image/png' },
    );
    expect(duplicada.status).toBe(409);
    expect(archivosDe(negocioA.id)).toHaveLength(archivosAntes);

    const enB = await registrar(
      tokenB,
      SLUG_B,
      { nombre: 'Cera mate', precio: 35000 },
      { contenido: PNG_VALIDO, nombre: 'producto.png', tipo: 'image/png' },
    );
    expect(enB.status).toBe(201);
    expect(cuerpo<ProductoRegistrado>(enB).producto.imagenUrl).toContain(
      `/negocios/${negocioB.id}/productos/`,
    );
  });

  it('3. acepta imagen opcional y rechaza contenido no permitido', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    const sinImagen = await registrar(token, SLUG_A, {
      nombre: 'Sin imagen',
      precio: 10000,
    });
    expect(sinImagen.status).toBe(201);
    expect(cuerpo<ProductoRegistrado>(sinImagen).producto.imagenUrl).toBeNull();

    const archivoVacio = await registrar(
      token,
      SLUG_A,
      { nombre: 'Archivo vacío', precio: 10000 },
      {
        contenido: Buffer.alloc(0),
        nombre: 'vacio.png',
        tipo: 'image/png',
      },
    );
    expect(archivoVacio.status).toBe(400);

    const svg = await registrar(
      token,
      SLUG_A,
      { nombre: 'SVG', precio: 10000 },
      {
        contenido: Buffer.from(SVG_NO_PERMITIDO),
        nombre: 'producto.svg',
        tipo: 'image/svg+xml',
      },
    );
    expect(svg.status).toBe(400);

    const html = await registrar(
      token,
      SLUG_A,
      { nombre: 'HTML', precio: 10000 },
      {
        contenido: Buffer.from('<html><script>alert(1)</script></html>'),
        nombre: 'producto.png',
        tipo: 'image/png',
      },
    );
    expect(html.status).toBe(400);

    const grande = Buffer.concat([
      PNG_VALIDO,
      Buffer.alloc(5 * 1024 * 1024 + 1024, 0x20),
    ]);
    const archivoGrande = await registrar(
      token,
      SLUG_A,
      { nombre: 'Archivo grande', precio: 10000 },
      {
        contenido: grande,
        nombre: 'grande.png',
        tipo: 'image/png',
      },
    );
    expect(archivoGrande.status).toBe(413);

    expect(archivosDe(negocioA.id)).toHaveLength(0);
  });

  it('4. rechaza precios fuera de rango o con más de dos decimales', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    for (const precio of ['0', '-1', '100000000', '10.999']) {
      const respuesta = await registrar(
        token,
        SLUG_A,
        { nombre: `Precio ${precio}`, precio },
        { contenido: PNG_VALIDO, nombre: 'producto.png', tipo: 'image/png' },
      );

      expect(respuesta.status).toBe(400);
    }
  });

  it('5. rechaza campos que el cliente no puede fijar', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await registrar(
      token,
      SLUG_A,
      { nombre: 'Intruso', precio: 10000 },
      { contenido: PNG_VALIDO, nombre: 'producto.png', tipo: 'image/png' },
      { negocioId: '999', estado: 'INACTIVO' },
    );

    expect(respuesta.status).toBe(400);
  });

  it('6. un administrador de A no puede registrar en B', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();
    const tokenA = await login('admin-a@test.local', SLUG_A);

    const respuesta = await registrar(
      tokenA,
      SLUG_B,
      { nombre: 'Cera', precio: 10000 },
      { contenido: PNG_VALIDO, nombre: 'producto.png', tipo: 'image/png' },
    );

    expect(respuesta.status).toBe(403);
  });

  it('7. un usuario sin rol administrativo recibe 403 y sin token 401', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();
    const tokenBarbero = await login('barbero-a@test.local', SLUG_A);

    const sinRol = await registrar(
      tokenBarbero,
      SLUG_A,
      { nombre: 'Cera', precio: 10000 },
      { contenido: PNG_VALIDO, nombre: 'producto.png', tipo: 'image/png' },
    );
    expect(sinRol.status).toBe(403);

    const sinToken = await registrar(
      undefined,
      SLUG_A,
      { nombre: 'Cera', precio: 10000 },
      { contenido: PNG_VALIDO, nombre: 'producto.png', tipo: 'image/png' },
    );
    expect(sinToken.status).toBe(401);
  });

  it('[Visualización de productos] el listado devuelve nombre, descripción, precio, imagen y estado', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    await crearProducto(negocioA.id, {
      nombre: 'Cera mate',
      descripcion: 'Fijación fuerte',
      precio: 35000.5,
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
    });
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await request(app.getHttpServer())
      .get('/productos')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);

    const { productos } = cuerpo<ProductosListado>(respuesta);
    expect(productos).toHaveLength(1);
    expect(productos[0]).toMatchObject({
      nombre: 'Cera mate',
      descripcion: 'Fijación fuerte',
      precio: 35000.5,
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
      estado: 'ACTIVO',
    });
  });

  it('[Identificación del estado] el listado distingue productos ACTIVO e INACTIVO', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    await crearProducto(negocioA.id, {
      nombre: 'Activo',
      precio: 10000,
      estado: 'ACTIVO',
    });
    await crearProducto(negocioA.id, {
      nombre: 'Inactivo',
      precio: 12000,
      estado: 'INACTIVO',
    });
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await request(app.getHttpServer())
      .get('/productos')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);

    const { productos } = cuerpo<ProductosListado>(respuesta);
    expect(productos.find((p) => p.nombre === 'Activo')?.estado).toBe('ACTIVO');
    expect(productos.find((p) => p.nombre === 'Inactivo')?.estado).toBe(
      'INACTIVO',
    );
  });

  it('[Catálogo sin productos registrados] responde colección vacía y mensaje sin error de servidor', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await request(app.getHttpServer())
      .get('/productos')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductosListado>(respuesta)).toEqual({
      mensaje: 'No existen productos registrados',
      productos: [],
    });
  });

  it('[Consulta de información del producto] el detalle devuelve toda la información registrada', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera mate',
      descripcion: 'Fijación fuerte',
      precio: 35000.5,
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
      estado: 'INACTIVO',
    });
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await request(app.getHttpServer())
      .get(`/productos/${producto.id}`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);

    const detalle = cuerpo<ProductoRegistrado['producto']>(respuesta);
    expect(detalle).toMatchObject({
      id: producto.id,
      nombre: 'Cera mate',
      descripcion: 'Fijación fuerte',
      precio: 35000.5,
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
      estado: 'INACTIVO',
    });
    expect(detalle.creadoEn).toBeDefined();
    expect(detalle.actualizadoEn).toBeDefined();
  });

  it('[Aislamiento] ni el listado ni el detalle revelan productos de otro tenant', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA, negocioB } = await sembrar();
    await crearProducto(negocioA.id, { nombre: 'Propio', precio: 10000 });
    const ajeno = await crearProducto(negocioB.id, {
      nombre: 'Ajeno',
      precio: 20000,
    });
    const tokenA = await login('admin-a@test.local', SLUG_A);

    const listado = await request(app.getHttpServer())
      .get('/productos')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(listado.status).toBe(200);
    const { productos } = cuerpo<ProductosListado>(listado);
    expect(productos.map((p) => p.nombre)).toEqual(['Propio']);

    const detalleAjeno = await request(app.getHttpServer())
      .get(`/productos/${ajeno.id}`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${tokenA}`);

    const detalleInexistente = await request(app.getHttpServer())
      .get('/productos/999999')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(detalleAjeno.status).toBe(detalleInexistente.status);
    expect(detalleAjeno.status).toBe(404);
    expect(cuerpo<{ message: string }>(detalleAjeno).message).toBe(
      cuerpo<{ message: string }>(detalleInexistente).message,
    );
  });

  it('[Validación] el detalle rechaza identificadores no positivos o no numéricos', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);

    const cero = await request(app.getHttpServer())
      .get('/productos/0')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    const texto = await request(app.getHttpServer())
      .get('/productos/abc')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    expect(cero.status).toBe(400);
    expect(texto.status).toBe(400);
  });

  it('[SUPERADMIN] el superadministrador de la barbería consulta su catálogo y no accede a otro tenant', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA, negocioB } = await sembrar();
    const propio = await crearProducto(negocioA.id, {
      nombre: 'Propio',
      precio: 10000,
    });
    const ajeno = await crearProducto(negocioB.id, {
      nombre: 'Ajeno',
      precio: 20000,
    });
    const token = await login('superadmin-a@test.local', SLUG_A);

    const listadoA = await request(app.getHttpServer())
      .get('/productos')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    const detallePropio = await request(app.getHttpServer())
      .get(`/productos/${propio.id}`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    const detalleAjeno = await request(app.getHttpServer())
      .get(`/productos/${ajeno.id}`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    const listadoB = await request(app.getHttpServer())
      .get('/productos')
      .set('X-Negocio-Slug', SLUG_B)
      .set('Authorization', `Bearer ${token}`);

    expect(listadoA.status).toBe(200);
    expect(
      cuerpo<ProductosListado>(listadoA).productos.map((p) => p.nombre),
    ).toEqual(['Propio']);
    expect(detallePropio.status).toBe(200);
    expect(detalleAjeno.status).toBe(404);
    expect(listadoB.status).toBe(403);
  });

  it('[Permisos] el listado y el detalle exigen rol administrativo y token', async () => {
    if (OMITIR_SIN_DOCKER || !conexion) return;

    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
    });
    const tokenBarbero = await login('barbero-a@test.local', SLUG_A);

    const listadoBarbero = await request(app.getHttpServer())
      .get('/productos')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${tokenBarbero}`);

    const detalleBarbero = await request(app.getHttpServer())
      .get(`/productos/${producto.id}`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${tokenBarbero}`);

    const listadoSinToken = await request(app.getHttpServer())
      .get('/productos')
      .set('X-Negocio-Slug', SLUG_A);

    const detalleSinToken = await request(app.getHttpServer())
      .get(`/productos/${producto.id}`)
      .set('X-Negocio-Slug', SLUG_A);

    expect(listadoBarbero.status).toBe(403);
    expect(detalleBarbero.status).toBe(403);
    expect(listadoSinToken.status).toBe(401);
    expect(detalleSinToken.status).toBe(401);
  });
});

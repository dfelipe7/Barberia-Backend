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
 * Esta suite exige Docker/MariaDB. Un skip silencioso ocultaría el
 * aislamiento real. Ver AGENTS.md §12.1.
 */
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

interface ProductoCatalogo {
  id: number;
  nombre: string;
  descripcion?: string | null;
  precio: number;
  imagenUrl: string | null;
}

interface ProductosCatalogo {
  mensaje?: string;
  productos: ProductoCatalogo[];
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
    if (process.env.MARIADB_TEST_SKIP === '1') {
      throw new Error(
        'La suite multitenant-productos exige Docker/MariaDB. ' +
          'MARIADB_TEST_SKIP=1 no está permitido en esta suite porque ocultaría ' +
          'el aislamiento real. Ver AGENTS.md §12.1.',
      );
    }

    directorioTemporal = fs.mkdtempSync(
      path.join(os.tmpdir(), 'barberia-productos-'),
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

  const fijarActualizadoEn = (id: number, fecha: Date) =>
    prisma.producto.update({
      where: { id },
      data: { actualizadoEn: fecha },
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

  const actualizar = (
    token: string | undefined,
    slug: string,
    id: number,
    campos: Record<string, string | number>,
    imagen?: { contenido: Buffer; nombre: string; tipo: string },
    extra?: Record<string, string>,
  ) => {
    let peticion = request(app.getHttpServer())
      .patch(`/productos/${id}`)
      .set('X-Negocio-Slug', slug);

    if (token) {
      peticion = peticion.set('Authorization', `Bearer ${token}`);
    }

    for (const [campo, valor] of Object.entries(campos)) {
      peticion = peticion.field(campo, String(valor));
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

  const cambiarEstado = (
    token: string | undefined,
    slug: string,
    id: number,
    estado: 'ACTIVO' | 'INACTIVO',
  ) => {
    let peticion = request(app.getHttpServer())
      .patch(`/productos/${id}/estado`)
      .set('X-Negocio-Slug', slug);

    if (token) {
      peticion = peticion.set('Authorization', `Bearer ${token}`);
    }

    return peticion.send({ estado });
  };

  it('HE-03-HU-01-CA-01 · HE-03-HU-01-CA-03 · 1. registra el producto con su imagen en el negocio del contexto', async () => {
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

  it('HE-03-HU-01-CA-02 · 3. acepta imagen opcional y rechaza contenido no permitido', async () => {
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

  it('HE-03-HU-01-CA-02 · 4. rechaza precios fuera de rango o con más de dos decimales', async () => {
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

  it('HE-03-HU-01-CA-02 · 5. rechaza campos que el cliente no puede fijar', async () => {
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

  it('HE-03-HU-01-CA-01 · 6. un administrador de A no puede registrar en B', async () => {
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

  it('HE-03-HU-01-CA-01 · 7. un usuario sin rol administrativo recibe 403 y sin token 401', async () => {
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

  it('HE-03-HU-01-CA-02 · rechaza nombre o precio ausentes sin crear fila', async () => {
    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);
    const antes = await prisma.producto.count({
      where: { negocioId: negocioA.id },
    });

    const sinNombre = await request(app.getHttpServer())
      .post('/productos')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`)
      .field('precio', '10000')
      .attach('imagen', PNG_VALIDO, {
        filename: 'producto.png',
        contentType: 'image/png',
      });
    expect(sinNombre.status).toBe(400);

    const sinPrecio = await request(app.getHttpServer())
      .post('/productos')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`)
      .field('nombre', 'Sin precio')
      .attach('imagen', PNG_VALIDO, {
        filename: 'producto.png',
        contentType: 'image/png',
      });
    expect(sinPrecio.status).toBe(400);

    const despues = await prisma.producto.count({
      where: { negocioId: negocioA.id },
    });
    expect(despues).toBe(antes);
    expect(archivosDe(negocioA.id)).toHaveLength(0);
  });

  it('HE-03-HU-01-CA-04 · la ausencia de endpoint de cancelación no persiste nada', async () => {
    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);
    const antes = await prisma.producto.count({
      where: { negocioId: negocioA.id },
    });

    const respuesta = await request(app.getHttpServer())
      .delete('/productos/999999')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    expect([404, 405]).toContain(respuesta.status);
    const despues = await prisma.producto.count({
      where: { negocioId: negocioA.id },
    });
    expect(despues).toBe(antes);
    expect(archivosDe(negocioA.id)).toHaveLength(0);
  });

  it('HE-03-HU-02-CA-01 · [Visualización de productos] el listado devuelve nombre, descripción, precio, imagen y estado', async () => {
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

  it('HE-03-HU-02-CA-02 · [Identificación del estado] el listado distingue productos ACTIVO e INACTIVO', async () => {
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

  it('HE-03-HU-02-CA-03 · [Catálogo sin productos registrados] responde colección vacía y mensaje sin error de servidor', async () => {
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

  it('HE-03-HU-02-CA-04 · HE-03-HU-03-CA-01 · [Consulta de información del producto] el detalle devuelve toda la información registrada', async () => {
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

  it('HE-03-HU-02-CA-04 · [Validación] el detalle rechaza identificadores no positivos o no numéricos', async () => {
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

  it('HE-03-HU-03-CA-02 · Actualización de datos: actualiza solo los campos enviados y conserva la imagen', async () => {
    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);
    const creado = await registrar(
      token,
      SLUG_A,
      { nombre: 'Cera', descripcion: 'Mate', precio: 10000 },
      { contenido: PNG_VALIDO, nombre: 'producto.png', tipo: 'image/png' },
    );
    expect(creado.status).toBe(201);
    const original = cuerpo<ProductoRegistrado>(creado).producto;

    const respuesta = await actualizar(token, SLUG_A, original.id, {
      nombre: '  Cera premium  ',
      precio: '25000.50',
    });

    expect(respuesta.status).toBe(200);
    const datos = cuerpo<ProductoRegistrado>(respuesta);
    expect(datos.mensaje).toBe('Producto actualizado correctamente');
    expect(datos.producto).toMatchObject({
      id: original.id,
      nombre: 'Cera premium',
      descripcion: 'Mate',
      precio: 25000.5,
      imagenUrl: original.imagenUrl,
      estado: 'ACTIVO',
    });

    const enBase = await prisma.producto.findUnique({
      where: { id: original.id },
    });
    expect(enBase?.nombre).toBe('Cera premium');
    expect(Number(enBase?.precio)).toBe(25000.5);
    expect(enBase?.descripcion).toBe('Mate');

    const limpiar = await actualizar(token, SLUG_A, original.id, {
      descripcion: '',
    });
    expect(limpiar.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(limpiar).producto.descripcion).toBeNull();

    await actualizar(token, SLUG_A, original.id, { descripcion: 'Temporal' });
    const anulada = await request(app.getHttpServer())
      .patch(`/productos/${original.id}`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`)
      .send({ descripcion: null });

    expect(anulada.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(anulada).producto.descripcion).toBeNull();
  });

  it('HE-03-HU-03-CA-02 · Actualización de datos: reemplaza la imagen y elimina la anterior', async () => {
    await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);
    const creado = await registrar(
      token,
      SLUG_A,
      { nombre: 'Cera con imagen', precio: 10000 },
      { contenido: PNG_VALIDO, nombre: 'vieja.png', tipo: 'image/png' },
    );
    expect(creado.status).toBe(201);
    const original = cuerpo<ProductoRegistrado>(creado).producto;
    const rutaVieja = path.resolve(
      directorioUploads(),
      original.imagenUrl!.replace('/uploads/', ''),
    );
    expect(fs.existsSync(rutaVieja)).toBe(true);

    const respuesta = await actualizar(
      token,
      SLUG_A,
      original.id,
      {},
      { contenido: PNG_VALIDO, nombre: 'nueva.png', tipo: 'image/png' },
    );

    expect(respuesta.status).toBe(200);
    const actualizado = cuerpo<ProductoRegistrado>(respuesta).producto;
    expect(actualizado.imagenUrl).not.toBe(original.imagenUrl);

    const rutaNueva = path.resolve(
      directorioUploads(),
      actualizado.imagenUrl!.replace('/uploads/', ''),
    );
    expect(fs.existsSync(rutaNueva)).toBe(true);
    expect(fs.existsSync(rutaVieja)).toBe(false);
  });

  it('HE-03-HU-03-CA-02 · Actualización de datos: reenviar los mismos valores no cambia actualizadoEn', async () => {
    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      descripcion: 'Mate',
      precio: 10000,
    });
    const fecha = new Date('2020-01-01T00:00:00.000Z');
    await fijarActualizadoEn(producto.id, fecha);

    const respuesta = await actualizar(token, SLUG_A, producto.id, {
      nombre: '  Cera  ',
      descripcion: '  Mate  ',
      precio: '10000',
    });

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(respuesta).producto.actualizadoEn).toBe(
      fecha.toISOString(),
    );

    const enBase = await prisma.producto.findUnique({
      where: { id: producto.id },
    });
    expect(enBase?.actualizadoEn.toISOString()).toBe(fecha.toISOString());
  });

  it('HE-03-HU-03-CA-02 · Actualización de datos: reenviar la misma descripción no cambia actualizadoEn', async () => {
    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      descripcion: 'Mate',
      precio: 10000,
    });
    const fecha = new Date('2020-01-01T00:00:00.000Z');
    await fijarActualizadoEn(producto.id, fecha);

    const respuesta = await actualizar(token, SLUG_A, producto.id, {
      descripcion: '  Mate  ',
    });

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(respuesta).producto.actualizadoEn).toBe(
      fecha.toISOString(),
    );
  });

  it('HE-03-HU-03-CA-02 · Actualización de datos: reenviar el mismo precio no cambia actualizadoEn', async () => {
    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      descripcion: 'Mate',
      precio: 10000,
    });
    const fecha = new Date('2020-01-01T00:00:00.000Z');
    await fijarActualizadoEn(producto.id, fecha);

    const respuesta = await actualizar(token, SLUG_A, producto.id, {
      precio: '10000',
    });

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(respuesta).producto.actualizadoEn).toBe(
      fecha.toISOString(),
    );
  });

  it('HE-03-HU-03-CA-02 · Actualización de datos: una imagen nueva cambia actualizadoEn aunque los datos sean iguales', async () => {
    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      descripcion: 'Mate',
      precio: 10000,
    });
    const fecha = new Date('2020-01-01T00:00:00.000Z');
    await fijarActualizadoEn(producto.id, fecha);

    const respuesta = await actualizar(
      token,
      SLUG_A,
      producto.id,
      {},
      { contenido: PNG_VALIDO, nombre: 'nueva.png', tipo: 'image/png' },
    );

    expect(respuesta.status).toBe(200);
    const actualizado = cuerpo<ProductoRegistrado>(respuesta).producto;
    expect(actualizado.imagenUrl).not.toBeNull();
    expect(new Date(actualizado.actualizadoEn!).getTime()).toBeGreaterThan(
      fecha.getTime(),
    );
  });

  it('HE-03-HU-03-CA-03 · Validación de información modificada: rechaza datos inválidos, duplicados y campos internos', async () => {
    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
    });
    await crearProducto(negocioA.id, {
      nombre: 'Aceite',
      precio: 12000,
    });

    const vacio = await actualizar(token, SLUG_A, producto.id, {});
    expect(vacio.status).toBe(400);

    const precio = await actualizar(token, SLUG_A, producto.id, {
      precio: '0',
    });
    expect(precio.status).toBe(400);

    const nombreNulo = await request(app.getHttpServer())
      .patch(`/productos/${producto.id}`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: null });
    expect(nombreNulo.status).toBe(400);

    const precioNulo = await request(app.getHttpServer())
      .patch(`/productos/${producto.id}`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`)
      .send({ precio: null });
    expect(precioNulo.status).toBe(400);

    const duplicado = await actualizar(token, SLUG_A, producto.id, {
      nombre: 'Aceite',
    });
    expect(duplicado.status).toBe(409);

    for (const campo of [
      'negocioId',
      'estado',
      'id',
      'creadoEn',
      'actualizadoEn',
      'imagenUrl',
    ]) {
      const interno = await actualizar(
        token,
        SLUG_A,
        producto.id,
        {},
        undefined,
        { [campo]: campo === 'estado' ? 'INACTIVO' : '999' },
      );
      expect(interno.status).toBe(400);
    }

    const internoConNombre = await actualizar(
      token,
      SLUG_A,
      producto.id,
      { nombre: 'Intruso' },
      undefined,
      { negocioId: '999' },
    );
    expect(internoConNombre.status).toBe(400);

    const nombreVacio = await actualizar(token, SLUG_A, producto.id, {
      nombre: '   ',
    });
    expect(nombreVacio.status).toBe(400);

    const descripcionLarga = await actualizar(token, SLUG_A, producto.id, {
      descripcion: 'x'.repeat(501),
    });
    expect(descripcionLarga.status).toBe(400);

    const precioDecimales = await actualizar(token, SLUG_A, producto.id, {
      precio: '10.999',
    });
    expect(precioDecimales.status).toBe(400);

    const inexistente = await actualizar(token, SLUG_A, 999999, {
      nombre: 'Fantasma',
    });
    expect(inexistente.status).toBe(404);

    const enBase = await prisma.producto.findUnique({
      where: { id: producto.id },
    });
    expect(enBase?.nombre).toBe('Cera');
    expect(Number(enBase?.precio)).toBe(10000);
    expect(enBase?.descripcion).toBeNull();
  });

  it('HE-03-HU-03-CA-04 · Confirmación de actualización: responde 200 con mensaje y producto actualizado', async () => {
    const { negocioA } = await sembrar();
    const token = await login('admin-a@test.local', SLUG_A);
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
    });

    const respuesta = await actualizar(token, SLUG_A, producto.id, {
      nombre: 'Cera nueva',
    });

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(respuesta)).toMatchObject({
      mensaje: 'Producto actualizado correctamente',
      producto: {
        id: producto.id,
        nombre: 'Cera nueva',
        precio: 10000,
      },
    });
  });

  it('HE-03-HU-03-CA-01 · Acceso a la edición: aísla tenants y exige rol administrativo', async () => {
    const { negocioA, negocioB } = await sembrar();
    const productoA = await crearProducto(negocioA.id, {
      nombre: 'Propio',
      precio: 10000,
    });
    const productoB = await crearProducto(negocioB.id, {
      nombre: 'Ajeno',
      precio: 20000,
    });
    const tokenA = await login('admin-a@test.local', SLUG_A);
    const tokenBarbero = await login('barbero-a@test.local', SLUG_A);
    const tokenSuper = await login('superadmin-a@test.local', SLUG_A);
    const tokenB = await login('admin-b@test.local', SLUG_B);

    const ajeno = await actualizar(tokenA, SLUG_A, productoB.id, {
      nombre: 'Intruso',
    });
    expect(ajeno.status).toBe(404);
    const enBase = await prisma.producto.findUnique({
      where: { id: productoB.id },
    });
    expect(enBase?.nombre).toBe('Ajeno');

    const inexistente = await actualizar(tokenA, SLUG_A, 999999, {
      nombre: 'Intruso',
    });
    expect(ajeno.status).toBe(inexistente.status);
    expect(cuerpo<{ message: string }>(ajeno).message).toBe(
      cuerpo<{ message: string }>(inexistente).message,
    );

    const barbero = await actualizar(tokenBarbero, SLUG_A, productoA.id, {
      nombre: 'Intruso',
    });
    expect(barbero.status).toBe(403);

    const sinToken = await actualizar(undefined, SLUG_A, productoA.id, {
      nombre: 'Intruso',
    });
    expect(sinToken.status).toBe(401);

    const adminOtroContexto = await actualizar(tokenB, SLUG_A, productoA.id, {
      nombre: 'Intruso',
    });
    expect(adminOtroContexto.status).toBe(403);

    const superAjeno = await actualizar(tokenSuper, SLUG_A, productoB.id, {
      nombre: 'Intruso',
    });
    expect(superAjeno.status).toBe(404);

    const superOtroContexto = await actualizar(
      tokenSuper,
      SLUG_B,
      productoB.id,
      { nombre: 'Intruso' },
    );
    expect(superOtroContexto.status).toBe(403);

    const propioEnBase = await prisma.producto.findUnique({
      where: { id: productoA.id },
    });
    expect(propioEnBase?.nombre).toBe('Propio');
  });

  it('HE-03-HU-03-CA-01 · Acceso a la edición: ADMINISTRADOR y SUPERADMIN del negocio editan su producto', async () => {
    const { negocioA } = await sembrar();
    const productoAdmin = await crearProducto(negocioA.id, {
      nombre: 'Admin',
      precio: 10000,
    });
    const productoSuper = await crearProducto(negocioA.id, {
      nombre: 'Super',
      precio: 12000,
    });
    const tokenAdmin = await login('admin-a@test.local', SLUG_A);
    const tokenSuper = await login('superadmin-a@test.local', SLUG_A);

    const admin = await actualizar(tokenAdmin, SLUG_A, productoAdmin.id, {
      nombre: 'Admin editado',
    });
    const superadmin = await actualizar(tokenSuper, SLUG_A, productoSuper.id, {
      nombre: 'Super editado',
    });

    expect(admin.status).toBe(200);
    expect(superadmin.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(admin).producto.nombre).toBe(
      'Admin editado',
    );
    expect(cuerpo<ProductoRegistrado>(superadmin).producto.nombre).toBe(
      'Super editado',
    );
  });

  it('HE-03-HU-04-CA-01 · Desactivación de un producto: deja de mostrarse entre los productos disponibles para los clientes', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
      estado: 'ACTIVO',
    });
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await cambiarEstado(
      token,
      SLUG_A,
      producto.id,
      'INACTIVO',
    );

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(respuesta)).toMatchObject({
      mensaje: 'Estado del producto actualizado correctamente',
      producto: { id: producto.id, estado: 'INACTIVO' },
    });

    const enBase = await prisma.producto.findUnique({
      where: { id: producto.id },
    });
    expect(enBase?.estado).toBe('INACTIVO');

    const listado = await request(app.getHttpServer())
      .get('/productos')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    expect(listado.status).toBe(200);
    expect(
      cuerpo<ProductosListado>(listado).productos.find(
        (p) => p.id === producto.id,
      )?.estado,
    ).toBe('INACTIVO');
  });

  it('HE-03-HU-04-CA-02 · Activación de un producto: vuelve a mostrarse entre los productos disponibles para los clientes', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
      estado: 'INACTIVO',
    });
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await cambiarEstado(token, SLUG_A, producto.id, 'ACTIVO');

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(respuesta)).toMatchObject({
      mensaje: 'Estado del producto actualizado correctamente',
      producto: { id: producto.id, estado: 'ACTIVO' },
    });

    const enBase = await prisma.producto.findUnique({
      where: { id: producto.id },
    });
    expect(enBase?.estado).toBe('ACTIVO');

    const listado = await request(app.getHttpServer())
      .get('/productos')
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`);

    expect(listado.status).toBe(200);
    expect(
      cuerpo<ProductosListado>(listado).productos.find(
        (p) => p.id === producto.id,
      )?.estado,
    ).toBe('ACTIVO');
  });

  it('HE-03-HU-04-CA-03 · Conservación de información: el cambio de estado conserva los datos del producto', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      descripcion: 'Mate',
      precio: 10000.5,
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
      estado: 'ACTIVO',
    });
    const fecha = new Date('2020-01-01T00:00:00.000Z');
    await fijarActualizadoEn(producto.id, fecha);
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await cambiarEstado(
      token,
      SLUG_A,
      producto.id,
      'INACTIVO',
    );

    expect(respuesta.status).toBe(200);

    const enBase = await prisma.producto.findUnique({
      where: { id: producto.id },
    });

    expect(enBase).toMatchObject({
      id: producto.id,
      negocioId: negocioA.id,
      nombre: 'Cera',
      descripcion: 'Mate',
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
      estado: 'INACTIVO',
    });
    expect(Number(enBase?.precio)).toBe(10000.5);
    expect(enBase?.creadoEn.toISOString()).toBe(
      producto.creadoEn.toISOString(),
    );
    expect(enBase?.actualizadoEn.getTime()).toBeGreaterThan(fecha.getTime());
  });

  it('HE-03-HU-04-CA-04 · Confirmación del cambio de estado: responde 200 con mensaje y producto con el estado nuevo', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
      estado: 'ACTIVO',
    });
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await cambiarEstado(
      token,
      SLUG_A,
      producto.id,
      'INACTIVO',
    );

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(respuesta)).toMatchObject({
      mensaje: 'Estado del producto actualizado correctamente',
      producto: { id: producto.id, estado: 'INACTIVO' },
    });
  });

  it('HE-03-HU-04-CA-04 · [Idempotencia] repetir el mismo estado responde 200 sin cambiar actualizadoEn', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
      estado: 'INACTIVO',
    });
    const fecha = new Date('2020-01-01T00:00:00.000Z');
    await fijarActualizadoEn(producto.id, fecha);
    const token = await login('admin-a@test.local', SLUG_A);

    const respuesta = await cambiarEstado(
      token,
      SLUG_A,
      producto.id,
      'INACTIVO',
    );

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductoRegistrado>(respuesta)).toMatchObject({
      mensaje: 'Estado del producto actualizado correctamente',
      producto: { id: producto.id, estado: 'INACTIVO' },
    });
    expect(cuerpo<ProductoRegistrado>(respuesta).producto.actualizadoEn).toBe(
      fecha.toISOString(),
    );

    const enBase = await prisma.producto.findUnique({
      where: { id: producto.id },
    });
    expect(enBase?.actualizadoEn.toISOString()).toBe(fecha.toISOString());
  });

  it('HE-03-HU-04-CA-04 · Idempotencia concurrente: dos PATCH simultáneos al mismo estado solo escriben una vez', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
      estado: 'ACTIVO',
    });
    const fecha = new Date('2020-01-01T00:00:00.000Z');
    await fijarActualizadoEn(producto.id, fecha);
    const token = await login('admin-a@test.local', SLUG_A);

    const [primero, segundo] = await Promise.all([
      cambiarEstado(token, SLUG_A, producto.id, 'INACTIVO'),
      cambiarEstado(token, SLUG_A, producto.id, 'INACTIVO'),
    ]);

    expect(primero.status).toBe(200);
    expect(segundo.status).toBe(200);
    const fechaPrimero =
      cuerpo<ProductoRegistrado>(primero).producto.actualizadoEn;
    const fechaSegundo =
      cuerpo<ProductoRegistrado>(segundo).producto.actualizadoEn;
    expect(fechaPrimero).toBe(fechaSegundo);
    expect(new Date(fechaPrimero!).getTime()).toBeGreaterThan(fecha.getTime());

    const enBase = await prisma.producto.findUnique({
      where: { id: producto.id },
    });
    expect(enBase?.estado).toBe('INACTIVO');
    expect(enBase?.actualizadoEn.toISOString()).toBe(fechaPrimero);

    const fechaFija = new Date('2021-01-01T00:00:00.000Z');
    await fijarActualizadoEn(producto.id, fechaFija);

    const [tercero, cuarto] = await Promise.all([
      cambiarEstado(token, SLUG_A, producto.id, 'INACTIVO'),
      cambiarEstado(token, SLUG_A, producto.id, 'INACTIVO'),
    ]);

    expect(tercero.status).toBe(200);
    expect(cuarto.status).toBe(200);

    const enBaseFinal = await prisma.producto.findUnique({
      where: { id: producto.id },
    });
    expect(enBaseFinal?.actualizadoEn.toISOString()).toBe(
      fechaFija.toISOString(),
    );
  });

  it('HE-03-HU-04-CA-04 · Concurrencia: dos PATCH simultáneos con estados distintos dejan un estado válido sin corromper la fila', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      descripcion: 'Mate',
      precio: 10000.5,
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
      estado: 'ACTIVO',
    });
    const token = await login('admin-a@test.local', SLUG_A);

    const [inactivo, activo] = await Promise.all([
      cambiarEstado(token, SLUG_A, producto.id, 'INACTIVO'),
      cambiarEstado(token, SLUG_A, producto.id, 'ACTIVO'),
    ]);

    expect(inactivo.status).toBe(200);
    expect(activo.status).toBe(200);

    const enBase = await prisma.producto.findUnique({
      where: { id: producto.id },
    });

    expect(['ACTIVO', 'INACTIVO']).toContain(enBase?.estado);
    expect(enBase).toMatchObject({
      id: producto.id,
      negocioId: negocioA.id,
      nombre: 'Cera',
      descripcion: 'Mate',
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
    });
    expect(Number(enBase?.precio)).toBe(10000.5);
    expect(enBase?.creadoEn.toISOString()).toBe(
      producto.creadoEn.toISOString(),
    );
  });

  it('[Aislamiento] el cambio de estado oculta productos de otro tenant como 404', async () => {
    const { negocioB } = await sembrar();
    const ajeno = await crearProducto(negocioB.id, {
      nombre: 'Ajeno',
      precio: 20000,
      estado: 'ACTIVO',
    });
    const tokenA = await login('admin-a@test.local', SLUG_A);
    const tokenSuperA = await login('superadmin-a@test.local', SLUG_A);

    const adminAjeno = await cambiarEstado(
      tokenA,
      SLUG_A,
      ajeno.id,
      'INACTIVO',
    );
    const superAjeno = await cambiarEstado(
      tokenSuperA,
      SLUG_A,
      ajeno.id,
      'INACTIVO',
    );
    const inexistente = await cambiarEstado(tokenA, SLUG_A, 999999, 'INACTIVO');

    expect(adminAjeno.status).toBe(404);
    expect(superAjeno.status).toBe(404);
    expect(adminAjeno.status).toBe(inexistente.status);
    expect(cuerpo<{ message: string }>(adminAjeno).message).toBe(
      cuerpo<{ message: string }>(inexistente).message,
    );

    const enBase = await prisma.producto.findUnique({
      where: { id: ajeno.id },
    });
    expect(enBase?.estado).toBe('ACTIVO');
  });

  it('[Validación] el cambio de estado rechaza estados distintos de ACTIVO o INACTIVO', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
    });
    const token = await login('admin-a@test.local', SLUG_A);

    const invalido = await request(app.getHttpServer())
      .patch(`/productos/${producto.id}/estado`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`)
      .send({ estado: 'ARCHIVADO' });

    const ausente = await request(app.getHttpServer())
      .patch(`/productos/${producto.id}/estado`)
      .set('X-Negocio-Slug', SLUG_A)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(invalido.status).toBe(400);
    expect(ausente.status).toBe(400);
  });

  it('[Permisos] el cambio de estado exige rol administrativo y token', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
    });
    const tokenAdmin = await login('admin-a@test.local', SLUG_A);
    const tokenSuper = await login('superadmin-a@test.local', SLUG_A);
    const tokenBarbero = await login('barbero-a@test.local', SLUG_A);

    const admin = await cambiarEstado(
      tokenAdmin,
      SLUG_A,
      producto.id,
      'INACTIVO',
    );
    const superadmin = await cambiarEstado(
      tokenSuper,
      SLUG_A,
      producto.id,
      'ACTIVO',
    );
    const barbero = await cambiarEstado(
      tokenBarbero,
      SLUG_A,
      producto.id,
      'INACTIVO',
    );
    const sinToken = await cambiarEstado(
      undefined,
      SLUG_A,
      producto.id,
      'INACTIVO',
    );

    expect(admin.status).toBe(200);
    expect(superadmin.status).toBe(200);
    expect(barbero.status).toBe(403);
    expect(sinToken.status).toBe(401);
  });

  it('HE-03-HU-05-CA-01 · Visualización de productos disponibles: el catálogo público muestra solo productos ACTIVO con datos mínimos', async () => {
    const { negocioA } = await sembrar();
    await crearProducto(negocioA.id, {
      nombre: 'Cera mate',
      descripcion: 'Fijación fuerte',
      precio: 35000.5,
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
      estado: 'ACTIVO',
    });
    await crearProducto(negocioA.id, {
      nombre: 'Aceite agotado',
      precio: 12000,
      estado: 'INACTIVO',
    });

    const respuesta = await request(app.getHttpServer())
      .get('/productos/catalogo')
      .set('X-Negocio-Slug', SLUG_A);

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductosCatalogo>(respuesta)).toEqual({
      productos: [
        {
          id: expect.any(Number),
          nombre: 'Cera mate',
          descripcion: 'Fijación fuerte',
          precio: 35000.5,
          imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
        },
      ],
    });
  });

  it('Visualización de productos disponibles: no acepta filtros manipulados ni negocioId ajeno', async () => {
    const { negocioA, negocioB } = await sembrar();
    await crearProducto(negocioA.id, { nombre: 'Propio', precio: 10000 });
    await crearProducto(negocioB.id, { nombre: 'Ajeno', precio: 20000 });

    const respuesta = await request(app.getHttpServer())
      .get('/productos/catalogo')
      .query({ negocioId: negocioB.id, estado: 'INACTIVO' })
      .set('X-Negocio-Slug', SLUG_A);

    expect(respuesta.status).toBe(200);
    expect(
      cuerpo<ProductosCatalogo>(respuesta).productos.map((p) => p.nombre),
    ).toEqual(['Propio']);
  });

  it('HE-03-HU-05-CA-02 · Información del producto: el detalle público devuelve nombre, descripción, precio e imagen', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera mate',
      descripcion: 'Fijación fuerte',
      precio: 35000.5,
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
      estado: 'ACTIVO',
    });

    const respuesta = await request(app.getHttpServer())
      .get(`/productos/catalogo/${producto.id}`)
      .set('X-Negocio-Slug', SLUG_A);

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductoCatalogo>(respuesta)).toEqual({
      id: producto.id,
      nombre: 'Cera mate',
      descripcion: 'Fijación fuerte',
      precio: 35000.5,
      imagenUrl: `/uploads/negocios/${negocioA.id}/productos/cera.png`,
    });
  });

  it('HE-03-HU-05-CA-03 · Producto no disponible: un producto INACTIVO responde 404 igual que uno inexistente', async () => {
    const { negocioA } = await sembrar();
    const inactivo = await crearProducto(negocioA.id, {
      nombre: 'Agotado',
      precio: 10000,
      estado: 'INACTIVO',
    });

    const detalleInactivo = await request(app.getHttpServer())
      .get(`/productos/catalogo/${inactivo.id}`)
      .set('X-Negocio-Slug', SLUG_A);

    const detalleInexistente = await request(app.getHttpServer())
      .get('/productos/catalogo/999999')
      .set('X-Negocio-Slug', SLUG_A);

    expect(detalleInactivo.status).toBe(404);
    expect(detalleInactivo.status).toBe(detalleInexistente.status);
    expect(cuerpo<{ message: string }>(detalleInactivo).message).toBe(
      cuerpo<{ message: string }>(detalleInexistente).message,
    );
  });

  it('HE-03-HU-05-CA-03 · Producto no disponible: un producto de otro negocio responde 404', async () => {
    const { negocioB } = await sembrar();
    const ajeno = await crearProducto(negocioB.id, {
      nombre: 'Ajeno',
      precio: 20000,
      estado: 'ACTIVO',
    });

    const respuesta = await request(app.getHttpServer())
      .get(`/productos/catalogo/${ajeno.id}`)
      .set('X-Negocio-Slug', SLUG_A);

    expect(respuesta.status).toBe(404);
  });

  it('HE-03-HU-05-CA-04 · Catálogo sin productos disponibles: responde colección vacía y mensaje', async () => {
    const { negocioA } = await sembrar();
    await crearProducto(negocioA.id, {
      nombre: 'Agotado',
      precio: 10000,
      estado: 'INACTIVO',
    });

    const respuesta = await request(app.getHttpServer())
      .get('/productos/catalogo')
      .set('X-Negocio-Slug', SLUG_A);

    expect(respuesta.status).toBe(200);
    expect(cuerpo<ProductosCatalogo>(respuesta)).toEqual({
      mensaje: 'No hay productos disponibles en este momento',
      productos: [],
    });
  });

  it('Visualización de productos disponibles: el catálogo y el detalle son públicos sin token', async () => {
    const { negocioA } = await sembrar();
    const producto = await crearProducto(negocioA.id, {
      nombre: 'Cera',
      precio: 10000,
    });

    const listado = await request(app.getHttpServer())
      .get('/productos/catalogo')
      .set('X-Negocio-Slug', SLUG_A);

    const detalle = await request(app.getHttpServer())
      .get(`/productos/catalogo/${producto.id}`)
      .set('X-Negocio-Slug', SLUG_A);

    expect(listado.status).toBe(200);
    expect(detalle.status).toBe(200);
  });

  it('Visualización de productos disponibles: exige contexto de negocio válido', async () => {
    await sembrar();

    const sinContexto = await request(app.getHttpServer()).get(
      '/productos/catalogo',
    );
    const negocioInvalido = await request(app.getHttpServer())
      .get('/productos/catalogo')
      .set('X-Negocio-Slug', 'negocio-inexistente');

    expect(sinContexto.status).toBe(403);
    expect(negocioInvalido.status).toBe(404);
  });

  it('HE-03-HU-05-CA-02 · Información del producto: rechaza identificadores no positivos en el detalle público', async () => {
    await sembrar();

    const cero = await request(app.getHttpServer())
      .get('/productos/catalogo/0')
      .set('X-Negocio-Slug', SLUG_A);
    const texto = await request(app.getHttpServer())
      .get('/productos/catalogo/abc')
      .set('X-Negocio-Slug', SLUG_A);

    expect(cero.status).toBe(400);
    expect(texto.status).toBe(400);
  });
});

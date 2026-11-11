import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { ContextoNegocioAlmacenamiento } from '../src/modules/negocios/negocio-almacenamiento';
import { crearExtensionAislamientoNegocio } from '../src/modules/negocios/prisma-extension-aislamiento';

/**
 * PRUEBA DE LA EXTENSIÓN DE PRISMA CONTRA MARIADB REAL (defensa adicional).
 *
 * Verifica que la extensión:
 *  - FILTRA las lecturas de modelos tenant-scoped por el negocio del
 *    contexto.
 *  - NO filtra los modelos globales (`Usuario`, `Negocio`,
 *    `ConfiguracionSistema`, `WhatsAppPlantilla`).
 *  - RECHAZA una escritura que intente asignar un negocio distinto al del
 *    contexto.
 *  - RECHAZA una lectura tenant-scoped sin contexto (fail-closed).
 *  - ACOTA un `upsert` al negocio del contexto.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const NEGOCIO_A = 1;
const NEGOCIO_B = 2;

describe('Extensión de Prisma: aislamiento por negocio (MariaDB real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prismaBase: PrismaClient;
  /**
   * Cliente extendido. El tipo de `$extends` en Prisma 7 es un Proxy complejo
   * que no se puede nombrar: se usa la firma del cliente base, que es
   * equivalente para lo que la prueba ejerce.
   */
  let prismaExtendido: PrismaClient;

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

    const url = new URL(conexion.urlBase);
    prismaBase = new PrismaClient({
      adapter: new PrismaMariaDb({
        host: url.hostname,
        port: Number(url.port),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.substring(1),
        connectionLimit: 5,
      }),
    });

    prismaExtendido = (
      prismaBase as unknown as { $extends: (e: unknown) => PrismaClient }
    ).$extends(crearExtensionAislamientoNegocio());

    // Datos de los dos negocios.
    await prismaBase.negocio.create({
      data: { id: NEGOCIO_A, slug: 'negocio-a', nombre: 'Negocio A' },
    });
    await prismaBase.negocio.create({
      data: { id: NEGOCIO_B, slug: 'negocio-b', nombre: 'Negocio B' },
    });

    const usuario = await prismaBase.usuario.create({
      data: {
        email: 'ext@test.local',
        nombre: 'Ext',
        apellido: 'Test',
        rol: 'PERSONAL',
      },
    });

    await prismaBase.barbero.create({
      data: {
        negocioId: NEGOCIO_A,
        usuarioId: usuario.id,
        telefono: '300',
        porcentajeComision: 10,
        negocioId: NEGOCIO_A,
      },
    });

    await prismaBase.cliente.create({
      data: { id: 1, nombre: 'Cliente A', negocioId: NEGOCIO_A },
    });
    await prismaBase.cliente.create({
      data: { id: 2, nombre: 'Cliente B', negocioId: NEGOCIO_B },
    });

    await prismaBase.producto.create({
      data: { nombre: 'Producto A', precio: 100, negocioId: NEGOCIO_A },
    });
    await prismaBase.producto.create({
      data: { nombre: 'Producto B', precio: 200, negocioId: NEGOCIO_B },
    });
  }, 300000);

  afterAll(async () => {
    ContextoNegocioAlmacenamiento.disable();
    await prismaBase?.$disconnect();
    conexion?.stop();
  });

  beforeEach(() => {
    ContextoNegocioAlmacenamiento.enterWith({
      id: NEGOCIO_A,
      slug: 'negocio-a',
    });
  });

  afterEach(() => {
    ContextoNegocioAlmacenamiento.disable();
  });

  /**
   * Establece el contexto de negocio en la cadena asíncrona del caso de
   * prueba.
   *
   * Se hace DENTRO del caso (y no en un `beforeEach`) porque `enterWith`
   * no propaga desde el `beforeEach` al cuerpo del test: el contexto debe
   * established en la misma cadena asíncrona que la consulta.
   */
  const conNegocioA = <T>(operacion: () => Promise<T>): Promise<T> => {
    ContextoNegocioAlmacenamiento.enterWith({
      id: NEGOCIO_A,
      slug: 'negocio-a',
    });

    return operacion();
  };

  it('filtra las lecturas de modelos tenant-scoped por el negocio del contexto', async () => {
    const clientes = await conNegocioA(() =>
      prismaExtendido.cliente.findMany(),
    );

    expect(clientes).toHaveLength(1);
    expect(clientes[0].id).toBe(1);
    expect(clientes[0].negocioId).toBe(NEGOCIO_A);
  });

  it('un findUnique con id ajeno no devuelve la fila de otro negocio', async () => {
    const cliente = await conNegocioA(() =>
      prismaExtendido.cliente.findUnique({ where: { id: 2 } }),
    );

    expect(cliente).toBeNull();
  });

  it('no filtra los modelos globales', async () => {
    const negocios = await conNegocioA(() =>
      prismaExtendido.negocio.findMany(),
    );
    const usuarios = await conNegocioA(() =>
      prismaExtendido.usuario.findMany(),
    );

    expect(negocios).toHaveLength(2);
    expect(usuarios.length).toBeGreaterThan(0);
  });

  it('rechaza una escritura que intente asignar otro negocio', async () => {
    await conNegocioA(() =>
      expect(
        prismaExtendido.cliente.update({
          where: { id: 2, negocioId: NEGOCIO_A },
          data: { nombre: 'Intruso' },
        }),
      ).rejects.toThrow(),
    );

    // La fila queda intacta.
    const cliente = await prismaBase.cliente.findUnique({ where: { id: 2 } });
    expect(cliente?.nombre).toBe('Cliente B');
  });

  it('rechaza una lectura tenant-scoped sin contexto (fail-closed)', async () => {
    ContextoNegocioAlmacenamiento.disable();

    await expect(prismaExtendido.cliente.findMany()).rejects.toThrow(
      /requiere un contexto de negocio autorizado/,
    );
  });

  it('acota un upsert al negocio del contexto', async () => {
    const barbero = await prismaBase.barbero.findFirst();

    const franja = await conNegocioA(() =>
      prismaExtendido.barberWeeklySlot.upsert({
        where: {
          barberoId_dayOfWeek_startTime: {
            barberoId: barbero!.id,
            dayOfWeek: 'MONDAY',
            startTime: '09:00',
          },
          negocioId: NEGOCIO_A,
        },
        update: { endTime: '13:00', active: true },
        create: {
          barberoId: barbero!.id,
          dayOfWeek: 'MONDAY',
          startTime: '09:00',
          endTime: '13:00',
          active: true,
          negocioId: NEGOCIO_A,
        },
      }),
    );

    expect(franja.negocioId).toBe(NEGOCIO_A);
  });

  it('filtra los productos por el negocio del contexto', async () => {
    const productos = await conNegocioA(() =>
      prismaExtendido.producto.findMany(),
    );

    expect(productos).toHaveLength(1);
    expect(productos[0].nombre).toBe('Producto A');
    expect(productos[0].negocioId).toBe(NEGOCIO_A);
  });

  it('un findUnique de un producto ajeno no devuelve la fila', async () => {
    const productoB = await prismaBase.producto.findFirst({
      where: { negocioId: NEGOCIO_B },
    });

    const producto = await conNegocioA(() =>
      prismaExtendido.producto.findUnique({ where: { id: productoB!.id } }),
    );

    expect(producto).toBeNull();
  });

  it('fuerza el negocio del contexto al crear un producto', async () => {
    const producto = await conNegocioA(() =>
      prismaExtendido.producto.create({
        data: { nombre: 'Producto C', precio: 300 },
      }),
    );

    expect(producto.negocioId).toBe(NEGOCIO_A);
  });
});

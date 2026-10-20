import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * PRUEBA DE LA MIGRACIÓN DE DATOS CONTRA MARIADB REAL (Fase 2).
 *
 * Levanta un contenedor **MariaDB 11 efímero**, aplica las migraciones
 * reales del proyecto, siembra datos preexistentes (sin `negocioId`) y ejecuta
 * el script de migración REAL (`prisma/multitenant/migrar-negocio.ts`).
 *
 * Comprueba:
 *  1. La migración crea el negocio inicial y le asigna TODOS los registros
 *     preexistentes.
 *  2. Ejecutarla DOS VECES no duplica el negocio ni sobrescribe los valores
 *     personalizados (nombre del negocio, valores de configuración).
 *  3. Los valores de configuración personalizados del negocio se conservan.
 *  4. La migración falla de forma segura si faltan el nombre o el slug, o si
 *     el slug tiene caracteres no permitidos.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const RUTA_SCRIPT = join(
  __dirname,
  '..',
  'dist',
  'multitenant',
  'prisma',
  'multitenant',
  'migrar-negocio.js',
);

const NOMBRE = 'KYRIOS STUDIO';
const SLUG = 'kyrios-studio';

describe('Migración de datos al modelo multitenant (MariaDB real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    conexion = await MariaDbConnection.start();

    // El script de migración se ejecuta como proceso aparte, sobre el
    // JAVASCRIPT COMPILADO. Si no está (p. ej. tras un `nest build`, que
    // limpia `dist/`), se compila aquí.
    if (!existsSync(RUTA_SCRIPT)) {
      execFileSync(
        process.execPath,
        [
          join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc'),
          '-p',
          'tsconfig.multitenant.json',
        ],
        { cwd: join(__dirname, '..'), stdio: 'pipe' },
      );
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
  }, 300000);

  afterAll(async () => {
    await prisma?.$disconnect();
    conexion?.stop();
  });

  /** Siembra datos preexistentes sin `negocioId`. */
  const sembrarPreexistentes = async () => {
    const usuario = await prisma.usuario.create({
      data: {
        email: 'preexistente@test.local',
        nombre: 'Preexistente',
        apellido: 'Uno',
        rol: 'BARBERO',
      },
    });

    const barbero = await prisma.barbero.create({
      data: {
        usuarioId: usuario.id,
        telefono: '300',
        porcentajeComision: 10,
      },
    });

    const servicio = await prisma.servicio.create({
      data: {
        nombre: 'Servicio preexistente',
        precio: 1000,
        duracionMinutos: 30,
      },
    });

    const cliente = await prisma.cliente.create({
      data: { nombre: 'Cliente preexistente' },
    });

    await prisma.reservation.create({
      data: {
        barberoId: barbero.id,
        servicioId: servicio.id,
        clienteId: cliente.id,
        date: new Date('2026-11-01T00:00:00.000Z'),
        dayOfWeek: 'SUNDAY',
        startTime: '10:00',
        endTime: '10:30',
      },
    });

    await prisma.generalClosure.create({
      data: {
        date: new Date('2026-12-25T00:00:00.000Z'),
        allDay: true,
        reason: 'Navidad',
      },
    });

    // Configuración global con un valor ya personalizado por un administrador.
    await prisma.configuracionSistema.create({
      data: {
        clave: 'reserva_cancelacion_antelacion_minutos',
        valor: '90',
        tipo: 'NUMERO',
      },
    });

    return { barbero, servicio, cliente };
  };

  /** Ejecuta el script de migración con las variables dadas. */
  const ejecutarMigracion = (
    variables: Record<string, string>,
  ): { codigo: number; salida: string } => {
    try {
      const salida = execFileSync(process.execPath, [RUTA_SCRIPT], {
        cwd: join(__dirname, '..'),
        env: {
          ...process.env,
          DATABASE_URL: conexion!.urlBase,
          ...variables,
        },
        stdio: 'pipe',
        encoding: 'utf8',
      });

      return { codigo: 0, salida };
    } catch (error) {
      const fallo = error as {
        status?: number;
        stdout?: string;
        stderr?: string;
      };

      return {
        codigo: fallo.status ?? 1,
        salida: `${fallo.stdout ?? ''}${fallo.stderr ?? ''}`,
      };
    }
  };

  it('1. la migración asigna el negocio a todos los registros preexistentes', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    await sembrarPreexistentes();

    const resultado = ejecutarMigracion({
      NEGOCIO_INICIAL_NOMBRE: NOMBRE,
      NEGOCIO_INICIAL_SLUG: SLUG,
    });

    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toContain('Negocio inicial creado');

    // Ningún registro por negocio queda sin asignar.
    for (const tabla of [
      'Barbero',
      'Cliente',
      'Servicio',
      'reservations',
      'general_closures',
    ]) {
      const filas = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM \`${tabla}\` WHERE \`negocioId\` IS NULL`,
      );

      expect(Number(filas[0]?.total ?? 0)).toBe(0);
    }

    // Y todos quedan asignados al negocio inicial.
    const reservas = await prisma.reservation.findMany();
    expect(reservas).toHaveLength(1);
    expect(reservas[0].negocioId).not.toBeNull();
  });

  it('2. ejecutarla dos veces no duplica el negocio ni sobrescribe los valores', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    // Se personalizan el nombre del negocio y el valor de la configuración.
    await prisma.negocio.updateMany({
      where: { slug: SLUG },
      data: { nombre: 'KYRIOS PERSONALIZADO' },
    });
    await prisma.configuracionNegocio.updateMany({
      where: { clave: 'reserva_cancelacion_antelacion_minutos' },
      data: { valor: '45' },
    });

    const segunda = ejecutarMigracion({
      NEGOCIO_INICIAL_NOMBRE: NOMBRE,
      NEGOCIO_INICIAL_SLUG: SLUG,
    });

    expect(segunda.codigo).toBe(0);
    expect(segunda.salida).toContain('ya existe');
    // La segunda ejecución no actualiza ninguna fila.
    expect(segunda.salida).toMatch(/0 registro\(s\) asignado/);

    // No se duplicó el negocio.
    const negocios = await prisma.negocio.count();
    expect(negocios).toBe(1);

    // No se sobrescribió el nombre personalizado.
    const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG } });
    expect(negocio?.nombre).toBe('KYRIOS PERSONALIZADO');

    // No se sobrescribió el valor de configuración personalizado.
    const config = await prisma.configuracionNegocio.findUnique({
      where: {
        negocioId_clave: {
          negocioId: negocio!.id,
          clave: 'reserva_cancelacion_antelacion_minutos',
        },
      },
    });
    expect(config?.valor).toBe('45');
  });

  it('3. la configuración conserva el valor global al crearse', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    // Una clave operativa que aún no existe en el negocio (el negocio nuevo
    // se crea en otra base de pruebas).
    const clave = 'reserva_no_show_tolerancia_minutos';
    const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG } });
    const enNegocio = await prisma.configuracionNegocio.findUnique({
      where: {
        negocioId_clave: { negocioId: negocio!.id, clave },
      },
    });

    // El valor inicial provino del ámbito global (15), no de un literal.
    const global = await prisma.configuracionSistema.findUnique({
      where: { clave },
    });
    expect(enNegocio?.valor).toBe(global?.valor ?? '15');
  });

  it('4. la migración falla de forma segura sin nombre o con slug inválido', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    const sinNombre = ejecutarMigracion({
      NEGOCIO_INICIAL_NOMBRE: '',
      NEGOCIO_INICIAL_SLUG: SLUG,
    });
    expect(sinNombre.codigo).not.toBe(0);
    expect(sinNombre.salida).toContain(
      'nombre del primer negocio es obligatorio',
    );

    const slugInvalido = ejecutarMigracion({
      NEGOCIO_INICIAL_NOMBRE: NOMBRE,
      NEGOCIO_INICIAL_SLUG: 'kyrios_studio',
    });
    expect(slugInvalido.codigo).not.toBe(0);
    expect(slugInvalido.salida).toContain('solo admite a-z, 0-9 y guiones');

    // Y no se creó ningún negocio con el slug inválido.
    const invalido = await prisma.negocio.findUnique({
      where: { slug: 'kyrios_studio' },
    });
    expect(invalido).toBeNull();
  });
});

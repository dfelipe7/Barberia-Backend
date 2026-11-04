import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * PRUEBA DEL ENDURECIMIENTO DEL ESQUEMA (Fase 8) CONTRA MARIADB 11 REAL.
 *
 * Aplica el HISTORIAL COMPLETO de migraciones (incluida la migración final de
 * endurecimiento) sobre una base vacía y comprueba, contra el MOTOR:
 *
 *  1. El historial completo se aplica desde una base vacía.
 *  2. La migración final ABORTA con un error explícito si los datos no están
 *     listos (filas sin negocio) y NO modifica nada.
 *  3. Una reserva no puede vincular un cliente de A con un servicio de B.
 *  4. Una reserva no puede referenciar un barbero de B.
 *  5. Un barbero de A no puede asignarse a un servicio de B.
 *  6. Una entidad sin negocio no puede insertarse.
 *  7. Dos negocios pueden tener un servicio con el mismo nombre; en el mismo
 *     negocio, no.
 *  8. La misma identidad de Google puede tener fichas en distintos negocios y
 *     una persona puede tener perfiles en varios negocios.
 *  9. Las claves foráneas compuestas y las unicidades por negocio existen
 *     REALES en el motor.
 * 10. La unicidad de franja (`slotActivo`) sigue vigente: una reserva activa
 *     impide otra en la misma franja, `CANCELLED` la libera y `NO_SHOW` la
 *     mantiene ocupada.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const RAIZ = join(__dirname, '..');
const MIGRACIONES = join(RAIZ, 'prisma', 'migrations');
const MIGRACION_FINAL = '20261020120000_endurecer_esquema_multitenant';
const ESQUEMA = join(RAIZ, 'prisma', 'schema.prisma');

/** Fila con su negocio, para resolver identificadores reales. */
interface FilaNegocio {
  id: number;
  negocioId: number;
}

describe('Endurecimiento del esquema multitenant (MariaDB real)', () => {
  const contenedores: MariaDbConnection[] = [];
  const clientes: PrismaClient[] = [];

  /** Crea una base nueva (en el contenedor compartido) con su cliente Prisma. */
  const nuevaBase = async () => {
    const conexion = await MariaDbConnection.start();
    contenedores.push(conexion);

    const url = new URL(conexion.urlBase);
    const prisma = new PrismaClient({
      adapter: new PrismaMariaDb({
        host: url.hostname,
        port: Number(url.port),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.substring(1),
        connectionLimit: 5,
      }),
    });
    clientes.push(prisma);

    return { conexion, prisma };
  };

  /**
   * Ejecuta `prisma migrate deploy` contra la base indicada.
   *
   * @param url Base de datos destino.
   * @param directorioMigraciones Directorio alternativo de migraciones. Si se
   *   indica, se construye un proyecto Prisma temporal con ese directorio
   *   (para poder aplicar el historial SIN la migración final).
   */
  const desplegar = (
    url: string,
    directorioMigraciones?: string,
  ): { codigo: number; salida: string } => {
    const argumentos = [
      join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js'),
      'migrate',
      'deploy',
    ];

    let directorioConfig: string | undefined;

    if (directorioMigraciones) {
      directorioConfig = join(RAIZ, '.tmp-prisma-temporal');
      rmSync(directorioConfig, { recursive: true, force: true });
      mkdirSync(directorioConfig, { recursive: true });
      cpSync(ESQUEMA, join(directorioConfig, 'schema.prisma'));
      cpSync(directorioMigraciones, join(directorioConfig, 'migrations'), {
        recursive: true,
      });
      writeFileSync(
        join(directorioConfig, 'prisma7.config.ts'),
        [
          'import { defineConfig } from "prisma/config";',
          'export default defineConfig({',
          `  schema: ${JSON.stringify(join(directorioConfig, 'schema.prisma'))},`,
          '  migrations: {',
          `    path: ${JSON.stringify(join(directorioConfig, 'migrations'))},`,
          '  },',
          '  datasource: { url: process.env["DATABASE_URL"] },',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      argumentos.push('--config', join(directorioConfig, 'prisma7.config.ts'));
    }

    try {
      const salida = execFileSync(process.execPath, argumentos, {
        cwd: RAIZ,
        env: { ...process.env, DATABASE_URL: url },
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return { codigo: 0, salida };
    } catch (error) {
      const exec = error as {
        status?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        codigo: exec.status ?? 1,
        salida: `${exec.stdout ?? ''}\n${exec.stderr ?? ''}`,
      };
    } finally {
      if (directorioConfig) {
        rmSync(directorioConfig, { recursive: true, force: true });
      }
    }
  };

  afterAll(async () => {
    for (const prisma of clientes) {
      await prisma.$disconnect();
    }
    for (const contenedor of contenedores) {
      contenedor.stop();
    }
  });

  it('1. el historial completo de migraciones se aplica desde una base vacía', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { conexion } = await nuevaBase();
    const resultado = desplegar(conexion.urlBase);

    expect(resultado.codigo).toBe(0);
  }, 300000);

  it('2. la migración final aborta con un error explícito si los datos no están listos', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { conexion, prisma } = await nuevaBase();

    const copia = join(RAIZ, '.tmp-migraciones-sin-final');
    rmSync(copia, { recursive: true, force: true });
    mkdirSync(copia, { recursive: true });
    cpSync(MIGRACIONES, copia, { recursive: true });
    rmSync(join(copia, MIGRACION_FINAL), { recursive: true, force: true });

    const historico = desplegar(conexion.urlBase, copia);
    expect(historico.codigo).toBe(0);

    // Datos previos SIN negocio (el estado heredado del modelo mononegocio).
    await prisma.$executeRawUnsafe(
      "INSERT INTO `negocios` (`slug`, `nombre`, `estado`, `zonaHoraria`, `creadoEn`, `actualizadoEn`) VALUES ('kyrios-studio', 'KYRIOS STUDIO', 'ACTIVO', 'America/Bogota', NOW(3), NOW(3))",
    );
    await prisma.$executeRawUnsafe(
      "INSERT INTO `Usuario` (`email`, `nombre`, `apellido`, `rol`, `estado`) VALUES ('pre@pruebas.local', 'Pre', 'Vias', 'BARBERO', 'ACTIVO')",
    );
    await prisma.$executeRawUnsafe(
      "INSERT INTO `Barbero` (`usuarioId`, `negocioId`, `telefono`, `porcentajeComision`, `estado`) VALUES (1, NULL, '300', 10, 'ACTIVO')",
    );

    // Con la migración final presente, el despliegue DEBE ABORTAR.
    const conFinal = desplegar(conexion.urlBase, MIGRACIONES);
    expect(conFinal.codigo).not.toBe(0);
    expect(conFinal.salida).toContain('_fase8_sin_negocio_barbero');

    // Y no ha modificado nada: la columna sigue admitiendo NULL.
    const columnas = await prisma.$queryRawUnsafe<
      Array<{ is_nullable: string }>
    >(
      "SELECT IS_NULLABLE AS is_nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Barbero' AND COLUMN_NAME = 'negocioId'",
    );
    expect(columnas[0].is_nullable).toBe('YES');

    rmSync(copia, { recursive: true, force: true });
    await prisma.$disconnect();
  }, 300000);

  it('3-10. el esquema endurecido impide las relaciones entre negocios', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { conexion, prisma } = await nuevaBase();

    const despliegue = desplegar(conexion.urlBase);
    expect(despliegue.codigo).toBe(0);

    // Datos de dos negocios con perfiles, clientes y servicios.
    await prisma.$executeRawUnsafe(
      "INSERT INTO `negocios` (`slug`, `nombre`, `estado`, `zonaHoraria`, `creadoEn`, `actualizadoEn`) VALUES ('kyrios-studio', 'KYRIOS STUDIO', 'ACTIVO', 'America/Bogota', NOW(3), NOW(3)), ('negocio-b', 'Negocio B', 'ACTIVO', 'America/Bogota', NOW(3), NOW(3))",
    );
    await prisma.$executeRawUnsafe(
      "INSERT INTO `Usuario` (`email`, `nombre`, `apellido`, `rol`, `estado`) VALUES ('a@pruebas.local', 'A', 'Uno', 'PERSONAL', 'ACTIVO'), ('b@pruebas.local', 'B', 'Dos', 'PERSONAL', 'ACTIVO'), ('c@pruebas.local', 'C', 'Tres', 'PERSONAL', 'ACTIVO')",
    );
    // Barberos: el mismo usuario puede ser barbero en dos negocios.
    await prisma.$executeRawUnsafe(
      "INSERT INTO `Barbero` (`usuarioId`, `negocioId`, `telefono`, `porcentajeComision`, `estado`) VALUES (1, 1, '300', 10, 'ACTIVO'), (2, 2, '301', 10, 'ACTIVO'), (1, 2, '302', 10, 'ACTIVO')",
    );
    // Servicio con el MISMO nombre en los dos negocios.
    await prisma.$executeRawUnsafe(
      "INSERT INTO `Servicio` (`nombre`, `precio`, `duracionMinutos`, `estado`, `negocioId`, `creadoEn`, `actualizadoEn`) VALUES ('Corte', 20000, 30, 'ACTIVO', 1, NOW(3), NOW(3)), ('Corte', 25000, 30, 'ACTIVO', 2, NOW(3), NOW(3))",
    );
    // Cliente de cada negocio; el mismo Google puede tener ficha en ambos.
    await prisma.$executeRawUnsafe(
      "INSERT INTO `Cliente` (`nombre`, `googleId`, `email`, `negocioId`) VALUES ('Cliente A', 'google-1', 'a@pruebas.local', 1), ('Cliente B', 'google-1', 'b@pruebas.local', 2), ('Cliente B2', 'google-2', 'c@pruebas.local', 2)",
    );

    // Los identificadores reales se CONSULTAN: un INSERT fallido consume
    // valores de auto_increment, así que las ids no son necesariamente 1, 2, 3.
    const barberos = await prisma.$queryRawUnsafe<FilaNegocio[]>(
      'SELECT id, negocioId FROM `Barbero` ORDER BY id',
    );
    const clientes = await prisma.$queryRawUnsafe<FilaNegocio[]>(
      'SELECT id, negocioId FROM `Cliente` ORDER BY id',
    );
    const servicios = await prisma.$queryRawUnsafe<FilaNegocio[]>(
      'SELECT id, negocioId FROM `Servicio` ORDER BY id',
    );

    const barberoA = barberos.find((b) => b.negocioId === 1)!.id;
    const barberoB = barberos.find((b) => b.negocioId === 2)!.id;
    const clienteA = clientes.find((c) => c.negocioId === 1)!.id;
    const clienteB = clientes.find((c) => c.negocioId === 2)!.id;
    const servicioA = servicios.find((s) => s.negocioId === 1)!.id;
    const servicioB = servicios.find((s) => s.negocioId === 2)!.id;

    const insertarReserva = (
      barbero: number,
      servicio: number,
      cliente: number,
    ) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO \`reservations\` (\`barberoId\`, \`servicioId\`, \`clienteId\`, \`date\`, \`dayOfWeek\`, \`startTime\`, \`endTime\`, \`status\`, \`negocioId\`, \`createdAt\`, \`updatedAt\`) VALUES (${barbero}, ${servicio}, ${cliente}, '2026-11-02', 'MONDAY', '10:00', '11:00', 'CONFIRMED', 1, NOW(3), NOW(3))`,
      );

    // 3. Una reserva no puede vincular un cliente de A con un servicio de B.
    await expect(
      insertarReserva(barberoA, servicioB, clienteA),
    ).rejects.toThrow();

    // 4. Una reserva no puede referenciar un barbero de B.
    await expect(
      insertarReserva(barberoB, servicioA, clienteB),
    ).rejects.toThrow();

    // 5. Un barbero de A no puede asignarse a un servicio de B.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO \`BarberoServicio\` (\`barberoId\`, \`servicioId\`, \`negocioId\`, \`creadoEn\`) VALUES (${barberoA}, ${servicioB}, 1, NOW(3))`,
      ),
    ).rejects.toThrow();

    // 6. Una entidad sin negocio no puede insertarse.
    await expect(
      prisma.$executeRawUnsafe(
        "INSERT INTO `Barbero` (`usuarioId`, `negocioId`, `telefono`, `porcentajeComision`, `estado`) VALUES (3, NULL, '300', 10, 'ACTIVO')",
      ),
    ).rejects.toThrow();

    // 7. El mismo nombre de servicio NO puede repetirse en un negocio.
    await expect(
      prisma.$executeRawUnsafe(
        "INSERT INTO `Servicio` (`nombre`, `precio`, `duracionMinutos`, `estado`, `negocioId`, `creadoEn`, `actualizadoEn`) VALUES ('Corte', 30000, 30, 'ACTIVO', 1, NOW(3), NOW(3))",
      ),
    ).rejects.toThrow();

    // 8. El mismo Google y el mismo usuario tienen ficha/perfil en dos
    // negocios: permitido.
    const fichas = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      "SELECT (SELECT COUNT(*) FROM `Cliente` WHERE `googleId` = 'google-1') + (SELECT COUNT(*) FROM `Barbero` WHERE `usuarioId` = 1) AS total",
    );
    expect(Number(fichas[0].total)).toBe(4);

    // 9. Las claves foráneas compuestas existen REALES en el motor.
    const foraneas = await prisma.$queryRawUnsafe<
      Array<{ constraint_name: string }>
    >(
      "SELECT CONSTRAINT_NAME AS constraint_name FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME LIKE '%negocioId%'",
    );
    const nombres = foraneas.map((f) => f.constraint_name);
    expect(nombres).toEqual(
      expect.arrayContaining([
        'reservations_negocioId_barberoId_fkey',
        'reservations_negocioId_servicioId_fkey',
        'reservations_negocioId_clienteId_fkey',
        'BarberoServicio_negocioId_barberoId_fkey',
        'BarberoServicio_negocioId_servicioId_fkey',
        'barber_weekly_slots_negocioId_barberoId_fkey',
        'barber_schedule_blocks_negocioId_barberoId_fkey',
      ]),
    );

    // Las unicidades por negocio existen y las globales se conservan.
    const indices = await prisma.$queryRawUnsafe<Array<{ index_name: string }>>(
      'SELECT DISTINCT INDEX_NAME AS index_name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0',
    );
    const nombresIndice = indices.map((i) => i.index_name.toLowerCase());
    expect(nombresIndice).toEqual(
      expect.arrayContaining([
        'servicio_negocioid_nombre_key',
        'cliente_negocioid_googleid_key',
        'barbero_negocioid_usuarioid_key',
        'administrador_negocioid_usuarioid_key',
        'usuario_email_key',
        'negocios_slug_key',
      ]),
    );

    // 10. Ocupación de franja: CANCELLED libera, NO_SHOW mantiene.
    await insertarReserva(barberoA, servicioA, clienteA);

    // Una segunda reserva activa en la MISMA franja se rechaza.
    await expect(
      insertarReserva(barberoA, servicioA, clienteA),
    ).rejects.toThrow();

    // CANCELLED libera la franja: se puede volver a reservar.
    const activas = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      "SELECT id FROM `reservations` WHERE `status` = 'CONFIRMED' LIMIT 1",
    );
    await prisma.$executeRawUnsafe(
      `UPDATE \`reservations\` SET \`status\` = 'CANCELLED' WHERE \`id\` = ${activas[0].id}`,
    );
    await insertarReserva(barberoA, servicioA, clienteA);

    // NO_SHOW mantiene la franja ocupada.
    const noShows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      "SELECT id FROM `reservations` WHERE `status` = 'CONFIRMED' LIMIT 1",
    );
    await prisma.$executeRawUnsafe(
      `UPDATE \`reservations\` SET \`status\` = 'NO_SHOW' WHERE \`id\` = ${noShows[0].id}`,
    );
    await expect(
      insertarReserva(barberoA, servicioA, clienteA),
    ).rejects.toThrow();

    await prisma.$disconnect();
  }, 300000);
});

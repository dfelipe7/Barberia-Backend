import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MariaDbConnection } from './helpers/mariadb-test-container';

/**
 * GARANTÍA DEL PROCEDIMIENTO DE LIBERACIÓN.
 *
 * La Fase 8 normaliza el HISTORIAL de migraciones (mayúsculas/minúsculas en
 * los nombres de tabla) y añade la migración final de endurecimiento.
 *
 * Esta prueba comprueba una propiedad operativa del procedimiento:
 * `prisma migrate deploy` NO falla cuando una migración YA APLICADA tiene su
 * archivo modificado (el caso normal de una base de datos existente a la que se
 * le añade la migración final). Es lo que permite desplegar la Fase 8 sin
 * tener que reconstruir la base de datos.
 */
describe('Procedimiento de liberación de la Fase 8', () => {
  const rutaMigracion = join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260901233756_reorganizar_datos_usuario',
    'migration.sql',
  );

  let conexion: MariaDbConnection | undefined;
  let original: string;

  beforeAll(async () => {
    if (process.env.MARIADB_TEST_SKIP === '1') return;
    conexion = await MariaDbConnection.start();
    original = readFileSync(rutaMigracion, 'utf8');
  }, 300000);

  afterAll(async () => {
    if (original !== undefined) {
      writeFileSync(rutaMigracion, original, 'utf8');
    }
    conexion?.stop();
  });

  const desplegar = () => {
    try {
      execFileSync(
        process.execPath,
        [
          join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js'),
          'migrate',
          'deploy',
        ],
        {
          cwd: join(__dirname, '..'),
          env: { ...process.env, DATABASE_URL: conexion!.urlBase },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );
      return 0;
    } catch (error) {
      const exec = error as { status?: number; stdout?: string; stderr?: string };
      return exec.status ?? 1;
    }
  };

  it('una migración ya aplicada y modificada no impide migrate deploy', async () => {
    if (process.env.MARIADB_TEST_SKIP === '1') return;

    // 1. Se aplica el historial completo.
    expect(desplegar()).toBe(0);

    // 2. Se modifica (solo el archivo) una migración YA APLICADA.
    writeFileSync(
      rutaMigracion,
      `${original}\n-- modification de prueba (no altera el resultado)\n`,
      'utf8',
    );

    // 3. El despliegue SIGUE siendo posible: la migración modificada no se
    //    vuelve a ejecutar y no se detecta como divergencia.
    const codigo = desplegar();

    writeFileSync(rutaMigracion, original, 'utf8');

    expect(codigo).toBe(0);
  }, 300000);
});

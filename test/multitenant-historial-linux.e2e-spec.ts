import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { MariaDbConnection } from './helpers/mariadb-test-container';

/**
 * PRUEBA DE COMPATIBILIDAD DEL HISTORIAL DE MIGRACIONES CON
 * `lower_case_table_names=0` (modo habitual de un servidor Linux).
 *
 * Aplica el historial COMPLETO de migraciones del proyecto sobre una base
 * MariaDB 11 vacía en un servidor sensible a mayúsculas/minúsculas y
 * comprueba que el historial se aplica de principio a fin.
 *
 * Si el historial falla, la prueba lo REFLEJA (no se oculta): el mensaje de
 * error exacto queda en la salida de la consola y la fase 8 no puede declarar
 * la compatibilidad con Linux como validada.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

describe('Historial de migraciones con lower_case_table_names=0 (Linux)', () => {
  let conexion: MariaDbConnection | undefined;

  beforeAll(async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    conexion = await MariaDbConnection.start({ lowerCaseTableNames: false });
  }, 300000);

  afterAll(() => {
    conexion?.stop();
  });

  it('aplica el historial completo de migraciones en un servidor sensible a mayúsculas', () => {
    if (OMITIR_SIN_DOCKER) return;

    let salida = '';
    let codigo = 0;

    try {
      salida = execFileSync(
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
    } catch (error) {
      const exec = error as {
        status?: number;
        stdout?: string;
        stderr?: string;
      };
      codigo = exec.status ?? 1;
      salida = `${exec.stdout ?? ''}\n${exec.stderr ?? ''}`;
    }

    // Salida del comando: evidencia del resultado real.
    console.log(
      `[historial lctn=0] código=${codigo}\n${salida.trim()}`,
    );

    if (codigo !== 0) {
      // El historial NO es aplicable en un servidor sensible a mayúsculas.
      // Se documenta el fallo exacto en lugar de ocultarlo.
      throw new Error(
        `El historial de migraciones no se aplica con lower_case_table_names=0: ${salida
          .trim()
          .slice(-800)}`,
      );
    }

    expect(codigo).toBe(0);
  });
});

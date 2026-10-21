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
    console.log(`[historial lctn=0] código=${codigo}\n${salida.trim()}`);

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

  /**
   * Fase 12: el historial debe REPRODUCIR el esquema declarado.
   *
   * `prisma/schema.prisma` declara `@@unique([negocioId, id])` en el modelo
   * `Administrador`. La migración de la Fase 8 creó ese índice compuesto
   * únicamente en `Barbero`, `Servicio` y `Cliente` (los destinos de las
   * claves foráneas compuestas), por lo que el índice de `Administrador`
   * faltaba en el esquema real. La migración correctiva
   * `20261023120000_agregar_indice_unico_administrador_negocio` lo crea.
   *
   * Este test falla si esa paridad se rompe: es la comprobación que evita
   * que un `prisma migrate dev` futuro detecte deriva y pida un reset.
   */
  it('reproduce el indice unico compuesto de Administrador declarado en el esquema', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const filas = await conexion!.consultar<{
      INDEX_NAME: string;
      NON_UNIQUE: number | string | bigint;
      SEQ_IN_INDEX: number;
      COLUMN_NAME: string;
    }>(
      `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'Administrador'
          AND INDEX_NAME = 'Administrador_negocioId_id_key'
        ORDER BY SEQ_IN_INDEX`,
    );

    expect(filas).toHaveLength(2);
    // `NON_UNIQUE` es un BIGINT: el driver puede devolverlo como número,
    // cadena o BigInt según el motor, así que se normaliza antes de comparar.
    expect(filas.every((fila) => Number(fila.NON_UNIQUE) === 0)).toBe(true);
    expect(filas.map((fila) => fila.COLUMN_NAME)).toEqual(['negocioId', 'id']);
  });
});

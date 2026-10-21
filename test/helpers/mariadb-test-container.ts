import { execFileSync, spawnSync } from 'node:child_process';
import { createConnection } from 'mariadb';

/**
 * Gestión de un contenedor MariaDB 11 o MySQL 8.0 efímero para las pruebas
 * de integración.
 *
 * Se usa el cliente `mariadb` (la misma familia de driver que ya usa el
 * adaptador `@prisma/adapter-mariadb`), de modo que la prueba no necesita
 * dependencias adicionales en el proyecto. Ese driver habla con ambos
 * motores: MariaDB 11 y MySQL 8.0.
 */
export class MariaDbConnection {
  private constructor(
    readonly nombreContenedor: string,
    readonly puerto: number,
    readonly usuario: string,
    readonly clave: string,
    readonly nombreBase: string,
  ) {}
  /** URL de conexión a la base de datos de pruebas. */
  get urlBase(): string {
    return `mysql://${this.usuario}:${this.clave}@127.0.0.1:${this.puerto}/${this.nombreBase}`;
  }

  /** Comprueba si Docker está disponible y en ejecución. */
  static dockerDisponible(): boolean {
    const resultado = spawnSync('docker', ['info'], { stdio: 'pipe' });

    return resultado.status === 0;
  }

  /**
   * Levanta un contenedor nuevo y espera a que acepte conexiones.
   *
   * @param opciones
   * - `lowerCaseTableNames: false` reproduce el modo de un servidor Linux
   *   (sensibilidad a mayúsculas/minúsculas). El valor por defecto (`true`)
   *   replica el ajuste de la base de datos del proyecto (MySQL en Windows),
   *   donde los nombres de tabla se almacenan en minúsculas. Es necesario
   *   porque el historial de migraciones del proyecto mezcla `Administrador`
   *   (creación) y `administrador` (ALTER posterior): sin este ajuste, esas
   *   sentencias no se resolverían.
   * - `motor: 'mysql'` levanta MySQL 8.0.46 (el motor del entorno local de
   *   desarrollo) en lugar de MariaDB 11.
   * - `nombreBase`: nombre de la base de datos creada en el contenedor. Por
   *   defecto `barberia_migracion_test`. Algunos comandos exigan una base
   *   concreta (por ejemplo, la de desarrollo), y el contenedor es
   *   desechable: el nombre no tiene efecto fuera de él.
   */
  static async start(
    opciones: {
      lowerCaseTableNames?: boolean;
      motor?: 'mariadb' | 'mysql';
      nombreBase?: string;
    } = {},
  ): Promise<MariaDbConnection> {
    const nombre = `barberia-mt-test-${process.pid}-${Date.now()}`;
    const usuario = 'root';
    const clave = 'pruebas123';
    const nombreBase = opciones.nombreBase ?? 'barberia_migracion_test';
    const lowerCaseTableNames = opciones.lowerCaseTableNames !== false;
    const esMySQL = opciones.motor === 'mysql';

    // Puerto efímero en el host: se deja que Docker lo asigne.
    //
    // `--lower-case-table-names=1` replica el ajuste de la base de datos del
    // proyecto (MySQL en Windows), donde los nombres de tabla se almacenan en
    // minúsculas. Es necesario porque el historial de migraciones del
    // proyecto mezcla `Administrador` (creación) y `administrador`
    // (ALTER posterior): sin este ajuste, esas sentencias no se resolverían.
    //
    // Con `lowerCaseTableNames: false` se reproduce el comportamiento de un
    // servidor Linux, donde los nombres de tabla NO se normalizan: es el
    // escenario en el que el historialmixto de mayúsculas/minúsculas falla.
    const argumentos = [
      'run',
      '--detach',
      '--rm',
      '--name',
      nombre,
      '--publish',
      '127.0.0.1::3306',
      '--env',
      `${esMySQL ? 'MYSQL' : 'MARIADB'}_ROOT_PASSWORD=${clave}`,
      '--env',
      `${esMySQL ? 'MYSQL' : 'MARIADB'}_DATABASE=${nombreBase}`,
      esMySQL ? 'mysql:8.0.46' : 'mariadb:11',
      `--lower-case-table-names=${lowerCaseTableNames ? 1 : 0}`,
    ];

    if (esMySQL) {
      // Charset y collation del entorno local de desarrollo (MySQL 8.0).
      argumentos.push(
        '--character-set-server=utf8mb4',
        '--collation-server=utf8mb4_unicode_ci',
      );
    }

    execFileSync('docker', argumentos, { stdio: 'pipe' });

    // Puerto asignado por Docker.
    const puertoTexto = execFileSync('docker', ['port', nombre, '3306/tcp'], {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    const puerto = Number(puertoTexto.split(':').pop());

    const conexion = new MariaDbConnection(
      nombre,
      puerto,
      usuario,
      clave,
      nombreBase,
    );

    await conexion.esperarDisponible();

    return conexion;
  }

  /** Espera a que el servidor acepte conexiones (hasta 180 s). */
  private async esperarDisponible(): Promise<void> {
    const limite = Date.now() + 180_000;

    while (Date.now() < limite) {
      try {
        await this.consultar('SELECT 1 AS ok');
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new Error(
      'El contenedor de base de datos no respondió a tiempo. Revisa la disponibilidad de Docker.',
    );
  }

  /** Conexión al contenedor de pruebas. */
  private async conectar() {
    return createConnection({
      host: '127.0.0.1',
      port: this.puerto,
      user: this.usuario,
      password: this.clave,
      database: this.nombreBase,
      // MySQL 8.0 usa `caching_sha2_password`: sin esta opción el driver no
      // puede obtener la clave RSA del servidor y la conexión falla con
      // `ER_CANNOT_RETRIEVE_RSA_KEY`. MariaDB 11 ignora la opción.
      allowPublicKeyRetrieval: true,
    });
  }

  /** Ejecuta una consulta parametrizada y devuelve las filas. */
  async consultar<T = Record<string, unknown>>(
    sql: string,
    parametros: unknown[] = [],
  ): Promise<T[]> {
    const conexion = await this.conectar();

    try {
      const filas = (await conexion.query(sql, parametros)) as unknown;
      return filas as T[];
    } finally {
      await conexion.end();
    }
  }

  /** Ejecuta una sentencia de escritura parametrizada. */
  async ejecutar(sql: string, parametros: unknown[] = []): Promise<void> {
    const conexion = await this.conectar();

    try {
      await conexion.query(sql, parametros);
    } finally {
      await conexion.end();
    }
  }

  /** Detiene y elimina el contenedor. */
  stop(): void {
    spawnSync('docker', ['rm', '--force', this.nombreContenedor], {
      stdio: 'pipe',
    });
  }
}

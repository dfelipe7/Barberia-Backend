import { execFileSync, spawnSync } from 'node:child_process';
import { createConnection } from 'mariadb';

/**
 * Gestión de contenedores MariaDB 11 o MySQL 8.0 compartidos por una corrida de
 * pruebas de integración.
 *
 * Cada configuración de servidor (`motor` + `lowerCaseTableNames`) usa UN SOLO
 * contenedor durante toda la corrida. Cada llamada a `start()` crea una base de
 * datos nueva dentro de ese contenedor, de modo que las suites siguen aisladas
 * entre sí sin pagar el arranque de un motor por archivo de prueba. El
 * contenedor se elimina al final de la corrida desde `globalTeardown`.
 *
 * Se usa el cliente `mariadb` (la misma familia de driver que ya usa el
 * adaptador `@prisma/adapter-mariadb`), de modo que la prueba no necesita
 * dependencias adicionales en el proyecto. Ese driver habla con ambos
 * motores: MariaDB 11 y MySQL 8.0.
 */
export class MariaDbConnection {
  /** Sufijo para bases únicas dentro del contenedor compartido. */
  private static contadorBases = 0;

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

  /** Nombre determinista del contenedor compartido por configuración. */
  private static nombreCompartido(
    motor: 'mariadb' | 'mysql',
    lowerCaseTableNames: boolean,
  ): string {
    return `barberia-mt-shared-${motor}-lctn${lowerCaseTableNames ? 1 : 0}`;
  }

  /**
   * Estado del contenedor: `undefined` si no existe, `true`/`false` si existe.
   * Se usa `docker inspect` porque es mucho más económico que arrancarlo.
   */
  private static estaEnEjecucion(nombre: string): boolean | undefined {
    const resultado = spawnSync(
      'docker',
      ['inspect', '-f', '{{.State.Running}}', nombre],
      { stdio: 'pipe', encoding: 'utf8' },
    );

    if (resultado.status !== 0) {
      return undefined;
    }

    return resultado.stdout.trim() === 'true';
  }

  /**
   * Reutiliza el contenedor de la configuración o lo levanta si aún no existe.
   *
   * Los workers de Jest son procesos separados: si dos llaman a `start()` a la
   * vez, ambos intentan crearlo y uno recibe el error de nombre duplicado. En
   * ese caso se espera a que el ganador termine de arrancarlo y se reutiliza.
   */
  private static async asegurarContenedor(
    nombre: string,
    motor: 'mariadb' | 'mysql',
    lowerCaseTableNames: boolean,
  ): Promise<void> {
    const estado = this.estaEnEjecucion(nombre);

    if (estado === true) {
      return;
    }

    if (estado === false) {
      execFileSync('docker', ['start', nombre], { stdio: 'pipe' });
      return;
    }

    const esMySQL = motor === 'mysql';
    const clave = 'pruebas123';
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
      `${esMySQL ? 'MYSQL' : 'MARIADB'}_DATABASE=barberia_migracion_test`,
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

    try {
      execFileSync('docker', argumentos, { stdio: 'pipe' });
      return;
    } catch (error) {
      // Otro worker pudo crear el mismo contenedor entre la inspección y el
      // `docker run`. Se espera a que esté disponible en lugar de fallar.
      const limite = Date.now() + 60_000;

      while (Date.now() < limite) {
        const actual = this.estaEnEjecucion(nombre);

        if (actual === true) {
          return;
        }

        if (actual === false) {
          execFileSync('docker', ['start', nombre], { stdio: 'pipe' });
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      throw error;
    }
  }

  /**
   * Provisiona una base nueva dentro del contenedor compartido y espera a que
   * el servidor acepte conexiones.
   *
   * @param opciones
   * - `lowerCaseTableNames: false` reproduce el modo de un servidor Linux
   *   (sensibilidad a mayúsculas/minúsculas). El valor por defecto (`true`)
   *   replica el ajuste de la base de datos del proyecto (MySQL en Windows),
   *   donde los nombres de tabla se almacenan en minúsculas. Es necesario
   *   porque el historial de migraciones del proyecto mezcla `Administrador`
   *   (creación) y `administrador` (ALTER posterior): sin este ajuste, esas
   *   sentencias no se resolverían.
   * - `motor: 'mysql'` usa MySQL 8.0.46 (el motor del entorno local de
   *   desarrollo) en lugar de MariaDB 11.
   * - `nombreBase`: nombre de la base de datos creada dentro del contenedor.
   *   Por defecto se genera uno único por llamada para no chocar con otras
   *   suites que corren en paralelo. Algunos comandos exigen una base concreta
   *   (por ejemplo, la de desarrollo); en ese caso se recrea en cada corrida.
   */
  static async start(
    opciones: {
      lowerCaseTableNames?: boolean;
      motor?: 'mariadb' | 'mysql';
      nombreBase?: string;
    } = {},
  ): Promise<MariaDbConnection> {
    const motor = opciones.motor ?? 'mariadb';
    const lowerCaseTableNames = opciones.lowerCaseTableNames !== false;
    const usuario = 'root';
    const clave = 'pruebas123';
    const nombreContenedor = this.nombreCompartido(motor, lowerCaseTableNames);
    const nombreBase =
      opciones.nombreBase ??
      `barberia_test_${process.pid}_${Date.now()}_${++this.contadorBases}`;

    await this.asegurarContenedor(nombreContenedor, motor, lowerCaseTableNames);

    const puertoTexto = execFileSync(
      'docker',
      ['port', nombreContenedor, '3306/tcp'],
      { stdio: 'pipe', encoding: 'utf8' },
    ).trim();
    const puerto = Number(puertoTexto.split(':').pop());

    const conexion = new MariaDbConnection(
      nombreContenedor,
      puerto,
      usuario,
      clave,
      nombreBase,
    );

    await conexion.esperarDisponible();
    await conexion.ejecutarEnServidor(
      `DROP DATABASE IF EXISTS \`${nombreBase}\``,
    );
    await conexion.ejecutarEnServidor(
      `CREATE DATABASE \`${nombreBase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    return conexion;
  }

  /** Espera a que el servidor acepte conexiones (hasta 180 s). */
  private async esperarDisponible(): Promise<void> {
    const limite = Date.now() + 180_000;

    while (Date.now() < limite) {
      try {
        await this.consultarEnServidor('SELECT 1 AS ok');
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
  private async conectar(sinBase = false) {
    return createConnection({
      host: '127.0.0.1',
      port: this.puerto,
      user: this.usuario,
      password: this.clave,
      ...(sinBase ? {} : { database: this.nombreBase }),
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

  /** Consulta al servidor sin seleccionar base (para provisionar la base). */
  private async consultarEnServidor<T>(sql: string): Promise<T[]> {
    const conexion = await this.conectar(true);

    try {
      const filas = (await conexion.query(sql)) as unknown;
      return filas as T[];
    } finally {
      await conexion.end();
    }
  }

  /** Sentencia al servidor sin seleccionar base (CREATE/DROP DATABASE). */
  private async ejecutarEnServidor(sql: string): Promise<void> {
    const conexion = await this.conectar(true);

    try {
      await conexion.query(sql);
    } finally {
      await conexion.end();
    }
  }

  /**
   * No detiene el contenedor: es compartido por toda la corrida y lo elimina
   * `globalTeardown`. Cada `start()` usa una base nueva, así que dejar la base
   * anterior no afecta a las demás suites.
   */
  stop(): void {
    // ponytail: contenedor compartido; globalTeardown lo elimina.
    return;
  }
}

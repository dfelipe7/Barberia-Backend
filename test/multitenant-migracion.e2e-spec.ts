import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { MariaDbConnection } from './helpers/mariadb-test-container';

/**
 * PRUEBA DE INTEGRACIÓN REAL CONTRA MARIADB (Fase 2).
 *
 * A diferencia de las pruebas unitarias (que simulan el cliente de base de
 * datos), esta prueba levanta un contenedor MariaDB efímero, aplica las
 * MIGRACIONES REALES del proyecto, siembra datos y ejecuta los scripts de
 * inicialización y backfill contra la base de datos real.
 *
 * Comprueba, sobre MariaDB de verdad:
 *   1. La migración aditiva de la Fase 1 se aplica sin errores.
 *   2. La inicialización crea el primer negocio y sus configuraciones.
 *   3. Ejecutar la inicialización DOS VECES no duplica el negocio ni
 *      sobrescribe el nombre, el estado ni los valores de configuración
 *      personalizados.
 *   4. El backfill asigna `negocioId` a todos los registros preexistentes.
 *   5. El backfill es idempotente: la segunda ejecución no cambia nada.
 *   6. La verificación de reconciliación detecta una mezcla de negocios.
 *
 * La prueba se OMITE (no falla) si no hay Docker disponible: el CI puede
 * ejecutarla donde lo haya, y el resto del equipo no queda bloqueado.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

describe('Migración multitenant sobre MariaDB real', () => {
  let contenedor: MariaDbConnection | undefined;
  let urlBase: string;

  beforeAll(async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    // Los scripts de `prisma/multitenant` se ejecutan como JavaScript
    // compilado. Se compilan aquí para que la prueba SIEMPRE pruebe el
    // código actual y no un `dist` obsoleto.
    compilarScripts();

    contenedor = await MariaDbConnection.start();
    urlBase = contenedor.urlBase;
  }, 300000);

  afterAll(() => {
    contenedor?.stop();
  });

  /**
   * Compila los scripts de `prisma/multitenant` a `dist/multitenant`.
   *
   * Sin este paso, la prueba ejecutaría un binario de una compilación
   * anterior y validaría código que ya no existe.
   */
  const compilarScripts = () => {
    execFileSync(
      process.execPath,
      [
        join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        join(__dirname, '..', 'tsconfig.multitenant.json'),
      ],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env },
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );
  };

  /**
   * Aplica las migraciones del proyecto contra la base de datos de pruebas.
   *
   * Se invoca el binario de Prisma con `node` en lugar de `npx`: en Windows,
   * `execFileSync` sobre `npx.cmd` termina el proceso sin código de salida
   * (status `null`), lo que hace que la migración no se aplique en silencio.
   */
  const aplicarMigraciones = () => {
    execFileSync(
      process.execPath,
      [
        join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js'),
        'migrate',
        'deploy',
      ],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: urlBase },
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );
  };

  /** Ejecuta un script de `prisma/multitenant` con las variables dadas. */
  const ejecutarScript = (
    script: string,
    variables: Record<string, string>,
  ): { codigo: number; salida: string } => {
    try {
      const salida = execFileSync(
        process.execPath,
        [
          join(
            __dirname,
            '..',
            'dist',
            'multitenant',
            'prisma',
            'multitenant',
            script,
          ),
        ],
        {
          cwd: join(__dirname, '..'),
          env: {
            ...process.env,
            DATABASE_URL: urlBase,
            ...variables,
          },
          stdio: 'pipe',
          encoding: 'utf8',
        },
      );

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

  const NOMBRE = 'Barbería Integration';
  const SLUG = 'barberia-integration';

  it('aplica las migraciones del proyecto sobre MariaDB', () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    expect(() => aplicarMigraciones()).not.toThrow();
  });

  it('crea el primer negocio y sus configuraciones operativas', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    const resultado = ejecutarScript('inicializar-primer-negocio.js', {
      NEGOCIO_INICIAL_NOMBRE: NOMBRE,
      NEGOCIO_INICIAL_SLUG: SLUG,
    });

    expect(resultado.codigo).toBe(0);

    const conteo = await contenedor!.consultar<{ total: number }>(
      'SELECT COUNT(*) AS total FROM `negocios` WHERE `slug` = ?',
      [SLUG],
    );
    expect(Number(conteo[0].total)).toBe(1);

    const configs = await contenedor!.consultar<{
      clave: string;
      valor: string;
    }>('SELECT `clave`, `valor` FROM `configuraciones_negocio`');

    expect(configs.map((c) => c.clave).sort()).toEqual([
      'reserva_cancelacion_antelacion_minutos',
      'reserva_no_show_tolerancia_minutos',
    ]);
    // Valores iniciales conocidos, conservados desde el ámbito global.
    expect(
      configs.find((c) => c.clave === 'reserva_cancelacion_antelacion_minutos')
        ?.valor,
    ).toBe('120');
    expect(
      configs.find((c) => c.clave === 'reserva_no_show_tolerancia_minutos')
        ?.valor,
    ).toBe('15');
  });

  it('ejecutar la inicialización dos veces no duplica ni sobrescribe', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    // Personalización, como haría un administrador entre ambas ejecuciones.
    await contenedor!.ejecutar(
      'UPDATE `negocios` SET `nombre` = ?, `estado` = ? WHERE `slug` = ?',
      ['Nombre Personalizado', 'INACTIVO', SLUG],
    );
    await contenedor!.ejecutar(
      'UPDATE `configuraciones_negocio` SET `valor` = ? WHERE `clave` = ?',
      ['45', 'reserva_cancelacion_antelacion_minutos'],
    );

    const resultado = ejecutarScript('inicializar-primer-negocio.js', {
      NEGOCIO_INICIAL_NOMBRE: NOMBRE,
      NEGOCIO_INICIAL_SLUG: SLUG,
    });

    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toContain('ya existía');

    const negocios = await contenedor!.consultar<{
      total: number;
      nombre: string;
      estado: string;
    }>(
      'SELECT COUNT(*) AS total, MIN(`nombre`) AS nombre, MIN(`estado`) AS estado FROM `negocios`',
    );

    // No se duplicó y los valores personalizados se conservaron.
    expect(Number(negocios[0].total)).toBe(1);
    expect(negocios[0].nombre).toBe('Nombre Personalizado');
    expect(negocios[0].estado).toBe('INACTIVO');

    const config = await contenedor!.consultar<{ valor: string }>(
      'SELECT `valor` FROM `configuraciones_negocio` WHERE `clave` = ?',
      ['reserva_cancelacion_antelacion_minutos'],
    );
    expect(config[0].valor).toBe('45');
  });

  it('el backfill asigna negocioId a todos los registros preexistentes', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    // Se reactiva el negocio (el paso anterior lo dejó INACTIVO) y se
    // insertan registros huérfanos en las tablas por negocio.
    await contenedor!.ejecutar(
      'UPDATE `negocios` SET `estado` = ? WHERE `slug` = ?',
      ['ACTIVO', SLUG],
    );

    await contenedor!.ejecutar(
      `INSERT INTO \`Usuario\` (\`email\`, \`nombre\`, \`apellido\`, \`rol\`, \`estado\`)
       VALUES ('prueba@barberia.test', 'Prueba', 'Prueba', 'BARBERO', 'ACTIVO')`,
    );

    const usuarioId = await contenedor!.consultar<{ id: number }>(
      'SELECT `id` FROM `Usuario` WHERE `email` = ?',
      ['prueba@barberia.test'],
    );

    await contenedor!.ejecutar(
      'INSERT INTO `Barbero` (`usuarioId`, `telefono`, `porcentajeComision`, `estado`) VALUES (?, ?, ?, ?)',
      [usuarioId[0].id, '3000000000', 10, 'ACTIVO'],
    );

    await contenedor!.ejecutar(
      "INSERT INTO `Servicio` (`nombre`, `descripcion`, `precio`, `duracionMinutos`, `estado`, `actualizadoEn`) VALUES ('Servicio Prueba', 'Prueba', 1000, 30, 'ACTIVO', NOW(3))",
    );

    const servicioId = await contenedor!.consultar<{ id: number }>(
      'SELECT `id` FROM `Servicio` WHERE `nombre` = ?',
      ['Servicio Prueba'],
    );

    await contenedor!.ejecutar(
      "INSERT INTO `Cliente` (`nombre`, `apellido`, `telefono`) VALUES ('Cliente', 'Prueba', '3011111111')",
    );

    const clienteId = await contenedor!.consultar<{ id: number }>(
      'SELECT `id` FROM `Cliente` WHERE `nombre` = ?',
      ['Cliente'],
    );

    const barberoId = await contenedor!.consultar<{ id: number }>(
      'SELECT `id` FROM `Barbero` WHERE `usuarioId` = ?',
      [usuarioId[0].id],
    );

    await contenedor!.ejecutar(
      'INSERT INTO `BarberoServicio` (`barberoId`, `servicioId`) VALUES (?, ?)',
      [barberoId[0].id, servicioId[0].id],
    );

    await contenedor!.ejecutar(
      "INSERT INTO `reservations` (`barberoId`, `servicioId`, `clienteId`, `date`, `dayOfWeek`, `startTime`, `endTime`, `status`, `updatedAt`) VALUES (?, ?, ?, '2026-11-01', 'SUNDAY', '10:00', '10:30', 'PENDING', NOW(3))",
      [barberoId[0].id, servicioId[0].id, clienteId[0].id],
    );

    await contenedor!.ejecutar(
      "INSERT INTO `barber_weekly_slots` (`barberoId`, `dayOfWeek`, `startTime`, `endTime`, `active`, `updatedAt`) VALUES (?, 'SUNDAY', '09:00', '17:00', 1, NOW(3))",
      [barberoId[0].id],
    );

    await contenedor!.ejecutar(
      "INSERT INTO `general_closures` (`date`, `allDay`, `reason`, `active`, `updatedAt`) VALUES ('2026-12-25', 1, 'Navidad', 1, NOW(3))",
    );

    // Antes del backfill, todo debe estar sin negocio.
    const previos = await contenedor!.consultar<{ total: number }>(
      'SELECT COUNT(*) AS total FROM `reservations` WHERE `negocioId` IS NULL',
    );
    expect(Number(previos[0].total)).toBe(1);

    const resultado = ejecutarScript('backfill-negocio.js', {
      NEGOCIO_INICIAL_SLUG: SLUG,
    });

    expect(resultado.codigo).toBe(0);

    // Ningún modelo por negocio puede quedar con filas sin negocio.
    for (const tabla of [
      'Administrador',
      'Barbero',
      'Cliente',
      'Servicio',
      'BarberoServicio',
      'reservations',
      'barber_weekly_slots',
      'barber_schedule_blocks',
      'general_closures',
    ]) {
      const pendientes = await contenedor!.consultar<{ total: number }>(
        `SELECT COUNT(*) AS total FROM \`${tabla}\` WHERE \`negocioId\` IS NULL`,
      );

      expect(Number(pendientes[0].total)).toBe(0);
    }

    // Y las filas sí están asignadas al negocio inicial.
    const asignadas = await contenedor!.consultar<{ total: number }>(
      'SELECT COUNT(*) AS total FROM `reservations` WHERE `negocioId` IS NOT NULL',
    );
    expect(Number(asignadas[0].total)).toBe(1);
  });

  it('el backfill es idempotente: la segunda ejecución no cambia nada', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    const antes = await contenedor!.consultar<{ total: number }>(
      'SELECT COUNT(*) AS total FROM `reservations` WHERE `negocioId` IS NOT NULL',
    );

    const resultado = ejecutarScript('backfill-negocio.js', {
      NEGOCIO_INICIAL_SLUG: SLUG,
    });

    expect(resultado.codigo).toBe(0);
    // La segunda ejecución no actualiza ninguna fila: el resumen lo delata
    // porque todas las filas ya estaban asignadas.
    expect(resultado.salida).toMatch(/sin negocio=\s*0/);
    expect(resultado.salida).toMatch(/asignadas=\s*0/);

    const despues = await contenedor!.consultar<{ total: number }>(
      'SELECT COUNT(*) AS total FROM `reservations` WHERE `negocioId` IS NOT NULL',
    );
    expect(Number(despues[0].total)).toBe(Number(antes[0].total));
  });

  it('la verificación de reconciliación detecta una mezcla de negocios', async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    // Estado correcto: la verificación pasa.
    const correcta = ejecutarScript('verificar-reconciliacion.js', {
      NEGOCIO_INICIAL_SLUG: SLUG,
    });
    expect(correcta.codigo).toBe(0);
    expect(correcta.salida).toContain('Reconciliación correcta');

    // Se crea un segundo negocio y se le asigna un registro: mezcla.
    // `actualizadoEn` no tiene valor por defecto en el esquema (lo gestiona
    // Prisma), por eso se informa explícitamente.
    await contenedor!.ejecutar(
      "INSERT INTO `negocios` (`slug`, `nombre`, `estado`, `zonaHoraria`, `actualizadoEn`) VALUES ('otro-negocio', 'Otro Negocio', 'ACTIVO', 'America/Bogota', NOW(3))",
    );

    const otroId = await contenedor!.consultar<{ id: number }>(
      'SELECT `id` FROM `negocios` WHERE `slug` = ?',
      ['otro-negocio'],
    );

    const clienteId = await contenedor!.consultar<{ id: number }>(
      'SELECT `id` FROM `Cliente` LIMIT 1',
    );

    await contenedor!.ejecutar(
      'UPDATE `Cliente` SET `negocioId` = ? WHERE `id` = ?',
      [otroId[0].id, clienteId[0].id],
    );

    const conMezcla = ejecutarScript('verificar-reconciliacion.js', {
      NEGOCIO_INICIAL_SLUG: SLUG,
    });

    // Debe FALLAR: hay un cliente de otro negocio.
    expect(conMezcla.codigo).toBe(1);
    expect(conMezcla.salida).toContain('inconsistencias');
  });
});

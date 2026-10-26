import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * MIGRACIÓN CONTROLADA DE LA DIRECCIÓN COMERCIAL CONTRA MYSQL 8.0 REAL
 * (Fase 16).
 *
 * Levanta un contenedor **MySQL 8.0.46 efímero**, aplica las migraciones
 * REALES y ejecuta el COMANDO REAL (`prisma/multitenant/migrar-direccion.ts`,
 * compilado por el procedimiento del proyecto) contra ese contenedor.
 *
 * No se usan mocks: la comprobación es sobre el esquema y los datos reales.
 *
 * Escenarios:
 *  1. Sin autorización explícita, el comando NO hace nada.
 *  2. Transfiere la dirección heredada cuando el perfil no tiene ninguna.
 *  3. NO sobrescribe una dirección ya configurada en el perfil.
 *  4. NO borra el valor heredado.
 *  5. Es idempotente: la segunda ejecución no cambia nada.
 *  6. El modo `--verificar` no escribe nada.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const RAIZ = join(__dirname, '..');
const SCRIPT = join(
  RAIZ,
  'dist',
  'multitenant',
  'prisma',
  'multitenant',
  'migrar-direccion.js',
);

const CLAVE_HEREDADA = 'negocio_direccion';

describe('Migración controlada de la dirección comercial (MySQL 8.0 real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prisma: PrismaClient;

  /** Compila el comando con el procedimiento del proyecto (`multitenant:build`). */
  const compilar = () => {
    execFileSync(
      process.execPath,
      [
        join(RAIZ, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        'tsconfig.multitenant.json',
      ],
      { cwd: RAIZ, stdio: 'pipe', encoding: 'utf8' },
    );
  };

  /** Ejecuta el comando con el entorno indicado. */
  const ejecutar = (entorno: Record<string, string>) => {
    try {
      const salida = execFileSync(process.execPath, [SCRIPT], {
        cwd: RAIZ,
        env: {
          ...process.env,
          DATABASE_URL: conexion!.urlBase,
          ...entorno,
        },
        stdio: 'pipe',
        encoding: 'utf8',
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
    }
  };

  /** Crea los dos negocios de prueba con sus valores heredados. */
  const sembrar = async () => {
    const negocioA = await prisma.negocio.upsert({
      where: { slug: 'negocio-a' },
      update: {},
      create: { slug: 'negocio-a', nombre: 'Negocio A' },
    });
    const negocioB = await prisma.negocio.upsert({
      where: { slug: 'negocio-b' },
      update: {},
      create: { slug: 'negocio-b', nombre: 'Negocio B' },
    });

    // A: valor heredado y SIN perfil -> se debe transferir.
    await prisma.configuracionNegocio.upsert({
      where: {
        negocioId_clave: { negocioId: negocioA.id, clave: CLAVE_HEREDADA },
      },
      update: { valor: 'Dirección Heredada de A' },
      create: {
        negocioId: negocioA.id,
        clave: CLAVE_HEREDADA,
        valor: 'Dirección Heredada de A',
        tipo: 'TEXTO',
        editable: true,
      },
    });

    // B: valor heredado Y perfil con dirección -> NO se debe sobrescribir.
    await prisma.configuracionNegocio.upsert({
      where: {
        negocioId_clave: { negocioId: negocioB.id, clave: CLAVE_HEREDADA },
      },
      update: { valor: 'Dirección Antigua de B' },
      create: {
        negocioId: negocioB.id,
        clave: CLAVE_HEREDADA,
        valor: 'Dirección Antigua de B',
        tipo: 'TEXTO',
        editable: true,
      },
    });

    await prisma.perfilNegocio.upsert({
      where: { negocioId: negocioB.id },
      update: {},
      create: {
        negocioId: negocioB.id,
        direccion: 'Dirección Ya Configurada de B',
        frasePrincipal: 'Perfil de B',
      },
    });

    return { negocioA, negocioB };
  };

  beforeAll(async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    conexion = await MariaDbConnection.start({
      motor: 'mysql',
      lowerCaseTableNames: false,
      // El comando exige la base de desarrollo: el contenedor es desechable y
      // el nombre no tiene efecto fuera de él.
      nombreBase: 'bd_barberia_multitenant_dev',
    });

    execFileSync(
      process.execPath,
      [
        join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js'),
        'migrate',
        'deploy',
      ],
      {
        cwd: RAIZ,
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

    compilar();
  }, 300000);

  afterAll(async () => {
    await prisma?.$disconnect();
    conexion?.stop();
  });

  it('1. sin autorización explícita no hace nada', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA } = await sembrar();

    const resultado = ejecutar({
      DIRECCION_MIGRACION_AUTORIZADA: '',
    });

    expect(resultado.codigo).toBe(1);

    const perfil = await prisma.perfilNegocio.findUnique({
      where: { negocioId: negocioA.id },
    });
    expect(perfil?.direccion ?? null).toBeNull();
  });

  it('2. transfiere la dirección heredada y respeta la ya configurada', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA, negocioB } = await sembrar();

    const resultado = ejecutar({
      DIRECCION_MIGRACION_AUTORIZADA: '1',
    });

    expect(resultado.codigo).toBe(0);

    const perfilA = await prisma.perfilNegocio.findUnique({
      where: { negocioId: negocioA.id },
    });
    expect(perfilA?.direccion).toBe('Dirección Heredada de A');

    // El perfil de B NO se sobrescribe.
    const perfilB = await prisma.perfilNegocio.findUnique({
      where: { negocioId: negocioB.id },
    });
    expect(perfilB?.direccion).toBe('Dirección Ya Configurada de B');
    expect(perfilB?.frasePrincipal).toBe('Perfil de B');

    // El valor heredado NO se borra.
    const heredadaA = await prisma.configuracionNegocio.findUnique({
      where: {
        negocioId_clave: { negocioId: negocioA.id, clave: CLAVE_HEREDADA },
      },
    });
    expect(heredadaA?.valor).toBe('Dirección Heredada de A');
  });

  it('3. es idempotente: la segunda ejecución no cambia nada', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { negocioA } = await sembrar();

    ejecutar({ DIRECCION_MIGRACION_AUTORIZADA: '1' });
    const segunda = ejecutar({ DIRECCION_MIGRACION_AUTORIZADA: '1' });

    expect(segunda.codigo).toBe(0);

    const perfil = await prisma.perfilNegocio.findUnique({
      where: { negocioId: negocioA.id },
    });
    expect(perfil?.direccion).toBe('Dirección Heredada de A');

    // Y solo hay un perfil por negocio.
    const perfiles = await prisma.perfilNegocio.count({
      where: { negocioId: negocioA.id },
    });
    expect(perfiles).toBe(1);
  });

  it('4. el modo verificar no escribe nada', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    // Un negocio NUEVO con valor heredado y sin perfil: el modo verificar no
    // debe crear nada.
    const negocioC = await prisma.negocio.create({
      data: { slug: 'negocio-c', nombre: 'Negocio C' },
    });
    await prisma.configuracionNegocio.create({
      data: {
        negocioId: negocioC.id,
        clave: CLAVE_HEREDADA,
        valor: 'Dirección Heredada de C',
        tipo: 'TEXTO',
        editable: true,
      },
    });

    const resultado = ejecutar({
      DIRECCION_MIGRACION_AUTORIZADA: '1',
      VERIFICAR_DIRECCION: '1',
    });

    expect(resultado.codigo).toBe(0);

    const perfil = await prisma.perfilNegocio.findUnique({
      where: { negocioId: negocioC.id },
    });
    expect(perfil ?? null).toBeNull();
  });
});

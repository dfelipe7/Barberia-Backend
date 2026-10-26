import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaModule } from '../src/prisma/prisma.module';
import { NegociosModule } from '../src/modules/negocios/negocios.module';
import { ConfiguracionModule } from '../src/modules/configuracion/configuracion.module';
import { ConfiguracionService } from '../src/modules/configuracion/service/configuracion.service';
import { NegocioContextoService } from '../src/modules/negocios/negocio-contexto.service';
import {
  CLAVES_CONFIGURACION,
  LIMITES_MINUTOS_OPERATIVOS,
  VALORES_POR_DEFECTO_OPERATIVOS,
} from '../src/modules/configuracion/configuracion.constants';

/**
 * PRUEBA DE CONFIGURACIÓN OPERATIVA POR NEGOCIO CONTRA MARIADB REAL (Fase 5).
 *
 * Levanta un contenedor **MariaDB 11 efímero**, aplica las migraciones REALES
 * del proyecto y comprueba la resolución del valor efectivo y el aislamiento
 * de la caché contra el motor de base de datos.
 *
 * Escenarios:
 *  1. Cada negocio obtiene SUS PROPIOS valores de configuración.
 *  2. Dos negocios pueden tener valores distintos de la misma clave.
 *  3. La caché de A no devuelve el valor de B.
 *  4. Invalidar la configuración de A no altera la de B.
 *  5. Una configuración de negocio ausente recurre al valor global permitido
 *     y, si tampoco existe, al valor por defecto.
 *  6. Un valor inválido utiliza el fallback seguro documentado.
 *  7. Una lectura operativa sin contexto válido falla de forma controlada.
 *  8. La caché global no se confunde con la caché de negocio.
 *  9. La inicialización es idempotente y no sobrescribe valores personalizados.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const CLAVE_ANTELACION =
  CLAVES_CONFIGURACION.RESERVA_CANCELACION_ANTELACION_MINUTOS;
const CLAVE_TOLERANCIA =
  CLAVES_CONFIGURACION.RESERVA_NO_SHOW_TOLERANCIA_MINUTOS;

describe('Configuración operativa por negocio (MariaDB real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prisma: PrismaClient;
  let app: INestApplication;
  let configuracionService: ConfiguracionService;
  let contextoService: NegocioContextoService;

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

    process.env.DATABASE_URL = conexion.urlBase;

    // Cliente Prisma SIN la extensión de aislamiento: la siembra de datos
    // ocurre fuera de una petición, sin contexto de negocio.
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

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        NegociosModule,
        ConfiguracionModule,
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    configuracionService = app.get(ConfiguracionService);
    contextoService = app.get(NegocioContextoService);
  }, 300000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    conexion?.stop();
  });

  /**
   * Siembra los datos de la prueba.
   *
   * `kyrios-studio` representa al primer negocio real (KYRIOS STUDIO) y
   * `negocio-b` a una segunda barbería con valores propios.
   */
  const sembrar = async () => {
    const kyrios = await prisma.negocio.upsert({
      where: { slug: 'kyrios-studio' },
      update: {},
      create: { slug: 'kyrios-studio', nombre: 'KYRIOS STUDIO' },
    });
    const negocioB = await prisma.negocio.upsert({
      where: { slug: 'negocio-b' },
      update: {},
      create: { slug: 'negocio-b', nombre: 'Negocio B' },
    });

    // Valores GLOBALES de plataforma (compatibilidad temporal).
    await prisma.configuracionSistema.upsert({
      where: { clave: CLAVE_ANTELACION },
      update: {},
      create: {
        clave: CLAVE_ANTELACION,
        valor: '120',
        tipo: 'NUMERO',
        descripcion: 'Antelación global de plataforma',
        editable: true,
      },
    });
    await prisma.configuracionSistema.upsert({
      where: { clave: CLAVE_TOLERANCIA },
      update: {},
      create: {
        clave: CLAVE_TOLERANCIA,
        valor: '15',
        tipo: 'NUMERO',
        descripcion: 'Tolerancia global de plataforma',
        editable: true,
      },
    });

    // Valores PROPIOS de cada negocio.
    await prisma.configuracionNegocio.deleteMany({});
    await prisma.configuracionNegocio.create({
      data: {
        negocioId: kyrios.id,
        clave: CLAVE_ANTELACION,
        valor: '30',
        tipo: 'NUMERO',
        descripcion: 'Antelación de KYRIOS STUDIO',
        editable: true,
      },
    });
    await prisma.configuracionNegocio.create({
      data: {
        negocioId: negocioB.id,
        clave: CLAVE_ANTELACION,
        valor: '60',
        tipo: 'NUMERO',
        descripcion: 'Antelación de Negocio B',
        editable: true,
      },
    });

    return { kyrios, negocioB };
  };

  /** Ejecuta la lectura como si la petición fuera del negocio indicado. */
  const leerEn = <T>(negocio: { id: number; slug: string }, operacion: () => Promise<T>) =>
    contextoService.ejecutarEnContexto(negocio, operacion);

  it('1. cada negocio obtiene sus propios valores de configuración', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB } = await sembrar();
    configuracionService.invalidarCache();

    const deKyrios = await leerEn(kyrios, () =>
      configuracionService.obtenerNumero(
        CLAVE_ANTELACION,
        VALORES_POR_DEFECTO_OPERATIVOS.RESERVA_CANCELACION_ANTELACION_MINUTOS,
        LIMITES_MINUTOS_OPERATIVOS,
      ),
    );
    const deNegocioB = await leerEn(negocioB, () =>
      configuracionService.obtenerNumero(
        CLAVE_ANTELACION,
        VALORES_POR_DEFECTO_OPERATIVOS.RESERVA_CANCELACION_ANTELACION_MINUTOS,
        LIMITES_MINUTOS_OPERATIVOS,
      ),
    );

    expect(deKyrios).toBe(30);
    expect(deNegocioB).toBe(60);
  });

  it('2 y 3. la caché de A no devuelve el valor de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB } = await sembrar();
    configuracionService.invalidarCache();

    const deKyrios = await leerEn(kyrios, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );
    const deNegocioB = await leerEn(negocioB, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );

    expect(deKyrios).toBe(30);
    expect(deNegocioB).toBe(60);

    // Segunda lectura de A: sigue siendo la de A (entrada de caché propia).
    const repetido = await leerEn(kyrios, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );
    expect(repetido).toBe(30);
  });

  it('4. invalidar la configuración de A no altera la de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB } = await sembrar();
    configuracionService.invalidarCache();

    await leerEn(kyrios, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );
    await leerEn(negocioB, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );

    // Se cambia el valor de A en base de datos y se invalida SOLO A.
    await prisma.configuracionNegocio.updateMany({
      where: { negocioId: kyrios.id, clave: CLAVE_ANTELACION },
      data: { valor: '45' },
    });
    configuracionService.invalidarCacheNegocio(kyrios.id, CLAVE_ANTELACION);

    const nuevoA = await leerEn(kyrios, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );
    const valorB = await leerEn(negocioB, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );

    expect(nuevoA).toBe(45);
    expect(valorB).toBe(60);
  });

  it('5. una configuración ausente recurre al global y después al default', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios, negocioB } = await sembrar();
    configuracionService.invalidarCache();

    // B no tiene la clave de tolerancia: hereda el valor global (15).
    const desdeGlobal = await leerEn(negocioB, () =>
      configuracionService.obtenerNumero(CLAVE_TOLERANCIA, 999),
    );
    expect(desdeGlobal).toBe(15);

    // Sin valor global válido, se aplica el valor por defecto.
    await prisma.configuracionSistema.deleteMany({
      where: { clave: CLAVE_TOLERANCIA },
    });
    configuracionService.invalidarCache();

    const desdeDefecto = await leerEn(kyrios, () =>
      configuracionService.obtenerNumero(CLAVE_TOLERANCIA, 999),
    );
    expect(desdeDefecto).toBe(999);
  });

  it('6. un valor inválido utiliza el fallback seguro documentado', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios } = await sembrar();
    configuracionService.invalidarCache();

    // Valor corrupto en el negocio: se descarta y se usa el global.
    await prisma.configuracionNegocio.updateMany({
      where: { negocioId: kyrios.id, clave: CLAVE_ANTELACION },
      data: { valor: 'no-es-un-numero' },
    });
    configuracionService.invalidarCacheNegocio(kyrios.id, CLAVE_ANTELACION);

    const desdeGlobal = await leerEn(kyrios, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );
    expect(desdeGlobal).toBe(120);

    // Valor fuera de los límites: también se descarta.
    await prisma.configuracionNegocio.updateMany({
      where: { negocioId: kyrios.id, clave: CLAVE_ANTELACION },
      data: { valor: '999999' },
    });
    configuracionService.invalidarCacheNegocio(kyrios.id, CLAVE_ANTELACION);

    const fueraDeLimites = await leerEn(kyrios, () =>
      configuracionService.obtenerNumero(
        CLAVE_ANTELACION,
        120,
        LIMITES_MINUTOS_OPERATIVOS,
      ),
    );
    expect(fueraDeLimites).toBe(120);
  });

  it('7. una lectura operativa sin contexto válido falla de forma controlada', async () => {
    if (OMITIR_SIN_DOCKER) return;

    await sembrar();

    await expect(
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('8. la caché global no se confunde con la caché de negocio', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios } = await sembrar();
    configuracionService.invalidarCache();

    // El global se cachea bajo su propia clave.
    const global = await configuracionService.obtenerNumeroGlobal(
      CLAVE_ANTELACION,
      120,
    );
    expect(global).toBe(120);

    // El valor del negocio NO es el global cacheado.
    const delNegocio = await leerEn(kyrios, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );
    expect(delNegocio).toBe(30);
  });

  it('9. la inicialización es idempotente y no sobrescribe valores personalizados', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const { kyrios } = await sembrar();
    configuracionService.invalidarCache();

    // Se personaliza la antelación de KYRIOS.
    await prisma.configuracionNegocio.updateMany({
      where: { negocioId: kyrios.id, clave: CLAVE_ANTELACION },
      data: { valor: '45' },
    });

    const primera = await configuracionService.inicializarValoresOperativos(
      kyrios.id,
    );
    const segunda = await configuracionService.inicializarValoresOperativos(
      kyrios.id,
    );

    // La clave de.antelación se conserva; la de tolerancia se crea la primera
    // vez y se conserva en la segunda.
    expect(primera.conservadas).toContain(CLAVE_ANTELACION);
    expect(segunda.creadas).toEqual([]);
    expect(segunda.conservadas).toContain(CLAVE_ANTELACION);
    expect(segunda.conservadas).toContain(CLAVE_TOLERANCIA);

    // El valor personalizado NO se ha sobrescrito.
    const valor = await leerEn(kyrios, () =>
      configuracionService.obtenerNumero(CLAVE_ANTELACION, 120),
    );
    expect(valor).toBe(45);
  });
});

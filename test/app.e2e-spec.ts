/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: comprobar el resultado real de GET / (health check) contra la aplicación montada.
 * - Responsabilidad: verificar el contrato de la ruta raíz. No verifica la base de datos ni la lógica de negocio.
 *
 * AISLAMIENTO DE LA BASE DE DATOS
 * -------------------------------
 * La aplicación se arranca contra un contenedor MySQL EFÍMERO (el mismo patrón
 * que las suites `multitenant*`), nunca contra la base de datos del entorno:
 * `PrismaService.onModuleInit` abre conexión y el servicio de arranque escribe
 * la configuración operativa de los negocios existentes, de modo que arrancar
 * contra `bd_barberia` sería una ESCRITURA en una base compartida.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { MariaDbConnection } from './helpers/mariadb-test-container';

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let conexion: MariaDbConnection | undefined;

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

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 300000);

  afterAll(async () => {
    await app?.close();
    conexion?.stop();
  });

  it('/ (GET) responde 200 con el cuerpo declarado', () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});

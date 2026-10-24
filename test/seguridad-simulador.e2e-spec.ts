/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: comprobar por HTTP que el simulador de error 500 exige sesión, rol y habilitación, y que un intento no autorizado no genera correo de alerta.
 * - Responsabilidad: pruebas HTTP del endpoint de diagnóstico. No toca base de datos ni envía correo real.
 *
 * La aplicación de prueba se monta con el filtro global real (para comprobar
 * la decisión de notificar) y con el servicio de alertas DOBLE (para comprobar
 * que no se invoca). El guard de autenticación se sustituye por una sesión
 * simulada: lo que se verifica aquí es la autorización y la notificación, no
 * la firma del token (esa tiene su propia suite).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { UsuariosController } from '../src/modules/usuarios/controller/usuarios.controller';
import { UsuariosService } from '../src/modules/usuarios/service/usuarios.service';
import { BarberosService } from '../src/modules/usuarios/service/barberos.service';
import { PersonalJwtService } from '../src/auth/sesion/personal-jwt.service';
import { NegocioContextoService } from '../src/modules/negocios/negocio-contexto.service';
import { AlertsService } from '../src/modules/alerts/alerts.service';
import { AllExceptionsFilter } from '../src/logger/all-exceptions.filter';

const RUTA = '/usuarios/simular-error-grave';
const SECRETO = 'SECRETO-DE-PRUEBA-NO-DEBE-APARECER';

const ROLES_POR_TOKEN: Record<string, string[]> = {
  'token-superadmin': ['SUPERADMIN'],
  'token-admin': ['ADMINISTRADOR'],
  'token-barbero': ['BARBERO'],
};

describe('H-01: el simulador de error grave exige sesión, rol y habilitación', () => {
  let app: INestApplication<App>;
  let alertsMock: { sendSecurityAlert: jest.Mock };
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  const entornoOriginal = { ...process.env };

  beforeAll(async () => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    alertsMock = { sendSecurityAlert: jest.fn().mockResolvedValue(undefined) };

    const personalJwtMock = {
      verificar: jest.fn((token: string) => ({
        id: 1,
        sub: 'kc-1',
        email: 'persona@ejemplo.com',
        roles: ROLES_POR_TOKEN[token] ?? ['BARBERO'],
        negocioId: 7,
        negocioSlug: 'prueba',
        ambito: 'NEGOCIO' as const,
        superadmin: false,
        estado: 'ACTIVO' as const,
      })),
    };

    const contextoMock = {
      obtenerContexto: () => ({ id: 7, slug: 'prueba' }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsuariosController],
      providers: [
        { provide: UsuariosService, useValue: {} },
        { provide: BarberosService, useValue: {} },
        { provide: PersonalJwtService, useValue: personalJwtMock },
        { provide: NegocioContextoService, useValue: contextoMock },
        { provide: AlertsService, useValue: alertsMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(alertsMock));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env = { ...entornoOriginal };
  });

  beforeEach(() => {
    alertsMock.sendSecurityAlert.mockClear();
    process.env = { ...entornoOriginal };
    delete process.env.SIMULADOR_ERROR_HABILITADO;
    delete process.env.NODE_ENV;
  });

  it('sin sesión responde 401 y NO envía alerta', async () => {
    process.env.SIMULADOR_ERROR_HABILITADO = 'true';

    const respuesta = await request(app.getHttpServer()).get(RUTA);

    expect(respuesta.status).toBe(401);
    expect(alertsMock.sendSecurityAlert).not.toHaveBeenCalled();
  });

  it('con sesión sin rol de administración responde 404 y NO envía alerta', async () => {
    process.env.SIMULADOR_ERROR_HABILITADO = 'true';

    const respuesta = await request(app.getHttpServer())
      .get(RUTA)
      .set('Authorization', 'Bearer token-barbero');

    expect(respuesta.status).toBe(404);
    expect(alertsMock.sendSecurityAlert).not.toHaveBeenCalled();
  });

  it('sin habilitación explícita responde 404 y NO envía alerta', async () => {
    const respuesta = await request(app.getHttpServer())
      .get(RUTA)
      .set('Authorization', 'Bearer token-superadmin');

    expect(respuesta.status).toBe(404);
    expect(alertsMock.sendSecurityAlert).not.toHaveBeenCalled();
  });

  it('en producción responde 404 y NO envía alerta, aunque esté habilitado', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SIMULADOR_ERROR_HABILITADO = 'true';

    const respuesta = await request(app.getHttpServer())
      .get(RUTA)
      .set('Authorization', 'Bearer token-superadmin');

    expect(respuesta.status).toBe(404);
    expect(alertsMock.sendSecurityAlert).not.toHaveBeenCalled();
  });

  it('en producción responde 404 y NO envía alerta con la variable ausente', async () => {
    process.env.NODE_ENV = 'production';

    const respuesta = await request(app.getHttpServer())
      .get(RUTA)
      .set('Authorization', 'Bearer token-superadmin');

    expect(respuesta.status).toBe(404);
    expect(alertsMock.sendSecurityAlert).not.toHaveBeenCalled();
  });

  it('con habilitación y rol de administración responde 500 y SÍ envía la alerta', async () => {
    process.env.SIMULADOR_ERROR_HABILITADO = 'true';

    const respuesta = await request(app.getHttpServer())
      .get(RUTA)
      .set('Authorization', 'Bearer token-admin');

    expect(respuesta.status).toBe(500);
    expect(alertsMock.sendSecurityAlert).toHaveBeenCalledTimes(1);
    expect(alertsMock.sendSecurityAlert).toHaveBeenCalledWith(
      500,
      expect.objectContaining({ status: 500 }),
    );
  });

  it('no filtra credenciales en el log ni en la alerta', async () => {
    process.env.SIMULADOR_ERROR_HABILITADO = 'true';

    const respuesta = await request(app.getHttpServer())
      .post(RUTA)
      .set('Authorization', `Bearer ${SECRETO}`)
      .send({ idToken: SECRETO });

    expect([401, 404, 500]).toContain(respuesta.status);

    const registrado = JSON.stringify([
      warnSpy.mock.calls,
      errorSpy.mock.calls,
      logSpy.mock.calls,
    ]);
    const notificado = JSON.stringify(alertsMock.sendSecurityAlert.mock.calls);

    expect(registrado).not.toContain(SECRETO);
    expect(notificado).not.toContain(SECRETO);
  });
});

/**
 * Trazabilidad:
 * - REQ: REQ-009, REQ-010
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: comprobar que el error se registra y se notifica sin filtrar credenciales.
 * - Responsabilidad: pruebas del filtro global. No comprueba el envío real de correo.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AlertsService } from '../modules/alerts/alerts.service';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let loggerMock: {
    warn: jest.Mock;
    error: jest.Mock;
    log: jest.Mock;
  };
  let alertsServiceMock: { sendSecurityAlert: jest.Mock };

  beforeEach(async () => {
    alertsServiceMock = {
      sendSecurityAlert: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllExceptionsFilter,
        { provide: AlertsService, useValue: alertsServiceMock },
      ],
    }).compile();

    filter = module.get<AllExceptionsFilter>(AllExceptionsFilter);
    loggerMock = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };
    (filter as any).logger = loggerMock;
  });

  it('debe estar definido', () => {
    expect(filter).toBeDefined();
  });

  it('debe manejar HttpException (ej. 403) y enviar alerta de seguridad', () => {
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const mockRequest = {
      url: '/test',
      method: 'GET',
      ip: '127.0.0.1',
      user: { sub: 'kc-123' },
      body: { test: 'data' },
    };
    const mockArgumentsHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    filter.catch(exception, mockArgumentsHost as any);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        path: '/test',
      }),
    );
    expect((filter as any).logger.warn).toHaveBeenCalled();
    expect(alertsServiceMock.sendSecurityAlert).toHaveBeenCalled();
  });

  it('debe manejar error interno (500) y enviar alerta de sistema', () => {
    const exception = new Error('Database connection failed');

    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const mockRequest = {
      url: '/test',
      method: 'GET',
      ip: '127.0.0.1',
    };
    const mockArgumentsHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    filter.catch(exception, mockArgumentsHost as any);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        path: '/test',
      }),
    );
    expect((filter as any).logger.error).toHaveBeenCalled();
    expect(alertsServiceMock.sendSecurityAlert).toHaveBeenCalled();
  });

  it('debe registrar error si el envío de alerta falla (promesa rechazada)', async () => {
    alertsServiceMock.sendSecurityAlert.mockRejectedValue(
      new Error('Fallo simulado'),
    );
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const mockRequest = { url: '/test', method: 'GET', ip: '127.0.0.1' };
    const mockArgumentsHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    filter.catch(exception, mockArgumentsHost as any);

    // Esperar a que la promesa del catch se resuelva
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((filter as any).logger.error).toHaveBeenCalledWith(
      'Error enviando alerta de seguridad',
      expect.any(Error),
    );
  });

  it('debe manejar errores de validación (ej. 400) sin enviar alertas', () => {
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const mockRequest = { url: '/test', method: 'GET', ip: '127.0.0.1' };
    const mockArgumentsHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    filter.catch(exception, mockArgumentsHost as any);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect((filter as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('Client Error [400]'),
    );
    expect(alertsServiceMock.sendSecurityAlert).not.toHaveBeenCalled();
  });

  it('debe incluir code y details cuando la excepción de dominio los aporta', () => {
    const exception = new HttpException(
      {
        statusCode: 409,
        message: 'El rango contiene una reserva no cancelada',
        code: 'SCHEDULE_BLOCK_HAS_RESERVATIONS',
        details: { barberoId: 7, fecha: '2026-10-20' },
      },
      HttpStatus.CONFLICT,
    );

    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const mockRequest = { url: '/test', method: 'POST', ip: '127.0.0.1' };
    const mockArgumentsHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    filter.catch(exception, mockArgumentsHost as any);

    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        path: '/test',
        message: 'El rango contiene una reserva no cancelada',
        code: 'SCHEDULE_BLOCK_HAS_RESERVATIONS',
        details: { barberoId: 7, fecha: '2026-10-20' },
      }),
    );
  });

  it('no debe incluir code/details cuando la excepción no los define', () => {
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };
    const mockRequest = { url: '/test', method: 'GET', ip: '127.0.0.1' };
    const mockArgumentsHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    filter.catch(exception, mockArgumentsHost as any);

    const payload = mockResponse.json.mock.calls[0][0];
    expect(payload).not.toHaveProperty('code');
    expect(payload).not.toHaveProperty('details');
  });

  describe('H-02: no filtración de credenciales', () => {
    const SECRETO = 'SECRETO-DE-PRUEBA-NO-DEBE-APARECER';

    const peticionConSecretos = (url = '/auth/google') => ({
      url,
      method: 'POST',
      ip: '127.0.0.1',
      headers: { authorization: `Bearer ${SECRETO}` },
      body: {
        idToken: SECRETO,
        password: SECRETO,
        refreshToken: SECRETO,
      },
    });

    const respuestaSimulada = () => ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    });

    const ejecutar = (exception: unknown, request: unknown) => {
      const mockResponse = respuestaSimulada();
      const mockArgumentsHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
          getRequest: () => request,
        }),
      } as unknown as ArgumentsHost;

      filter.catch(exception, mockArgumentsHost);

      return mockResponse;
    };

    /** Cuerpo JSON que el filtro devuelve al cliente. */
    const cuerpoRespuesta = (
      mockResponse: ReturnType<typeof respuestaSimulada>,
    ) =>
      mockResponse.json.mock.calls[0][0] as {
        statusCode: number;
        path: string;
        message: unknown;
      };

    /** Contexto que se envía al servicio de alertas (y de ahí al correo). */
    const contextoAlertado = () =>
      alertsServiceMock.sendSecurityAlert.mock.calls[0][1] as {
        path: string;
        requestId: string;
      };

    /** Todo lo registrado o notificado durante la prueba. */
    const rastro = () =>
      JSON.stringify(loggerMock.warn.mock.calls) +
      JSON.stringify(loggerMock.error.mock.calls) +
      JSON.stringify(loggerMock.log.mock.calls) +
      JSON.stringify(alertsServiceMock.sendSecurityAlert.mock.calls);

    it('no registra ni notifica el cuerpo de la petición', () => {
      ejecutar(
        new HttpException('Prohibido', HttpStatus.FORBIDDEN),
        peticionConSecretos(),
      );

      expect(rastro()).not.toContain(SECRETO);
    });

    it('no registra ni notifica el cuerpo en un error 500', () => {
      ejecutar(new Error('Fallo interno'), peticionConSecretos('/reservas'));

      expect(rastro()).not.toContain(SECRETO);
    });

    it('conserva el contexto operativo seguro', () => {
      ejecutar(
        new HttpException(
          {
            statusCode: 409,
            message: 'La franja ya está ocupada',
            code: 'SLOT_TAKEN',
          },
          HttpStatus.CONFLICT,
        ),
        { url: '/reservas', method: 'POST', ip: '127.0.0.1' },
      );

      const contexto = loggerMock.log.mock.calls[0][0] as string;
      expect(contexto).toContain('/reservas');
    });

    it('redacta los parámetros sensibles de la query en el contexto notificado', () => {
      ejecutar(
        new HttpException('Prohibido', HttpStatus.FORBIDDEN),
        peticionConSecretos('/auth/google?token=abc&codigo=123'),
      );

      expect(contextoAlertado().path).toBe(
        '/auth/google?token=[redactado]&codigo=[redactado]',
      );
    });

    it('redacta los nombres de parámetro sensibles habituales y sus variantes de caja', () => {
      const nombres = [
        'token',
        'access_token',
        'id_token',
        'code',
        'key',
        'authorization',
        'TOKEN',
        'Access_Token',
        'Id_Token',
        'Code',
        'KEY',
        'Authorization',
        'x-key',
        'api_key',
      ];

      for (const nombre of nombres) {
        const mockResponse = ejecutar(
          new HttpException('Prohibido', HttpStatus.FORBIDDEN),
          { url: `/r?${nombre}=secreto`, method: 'GET', ip: '127.0.0.1' },
        );

        expect(cuerpoRespuesta(mockResponse).path).toBe(
          `/r?${nombre}=[redactado]`,
        );
      }
    });

    it('no deja pasar el secreto de la query string a la respuesta de error', () => {
      const mockResponse = ejecutar(
        new HttpException('Prohibido', HttpStatus.FORBIDDEN),
        peticionConSecretos(`/auth/google?token=${SECRETO}`),
      );

      const cuerpo = cuerpoRespuesta(mockResponse);

      expect(cuerpo.path).not.toContain(SECRETO);
      expect(cuerpo.path).toBe('/auth/google?token=[redactado]');
    });

    it('el secreto no llega a ningún destino: log, alerta, respuesta ni cabecera', () => {
      const mockResponse = ejecutar(
        new HttpException('Prohibido', HttpStatus.FORBIDDEN),
        peticionConSecretos(`/auth/google?token=${SECRETO}`),
      );

      const cuerpo = cuerpoRespuesta(mockResponse);
      const identificador = mockResponse.setHeader.mock.calls[0][1] as string;

      expect(rastro()).not.toContain(SECRETO);
      expect(cuerpo.path).not.toContain(SECRETO);
      expect(identificador).not.toContain(SECRETO);
    });

    it('añade el identificador de petición al contexto y a la respuesta', () => {
      const mockResponse = ejecutar(
        new HttpException('Prohibido', HttpStatus.FORBIDDEN),
        { url: '/x', method: 'GET', ip: '127.0.0.1' },
      );

      const contexto = contextoAlertado();

      expect(contexto.requestId).toEqual(expect.any(String));
      expect(contexto.requestId.length).toBeGreaterThan(0);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-Request-Id',
        contexto.requestId,
      );
    });
  });
});

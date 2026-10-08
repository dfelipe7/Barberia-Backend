import { Test, TestingModule } from '@nestjs/testing';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AlertsService } from '../modules/alerts/alerts.service';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let loggerMock: any;
  let alertsServiceMock: any;

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
    (filter as any).logger = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };
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
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      path: '/test',
    }));
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
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500,
      path: '/test',
    }));
    expect((filter as any).logger.error).toHaveBeenCalled();
    expect(alertsServiceMock.sendSecurityAlert).toHaveBeenCalled();
  });

  it('debe registrar error si el envío de alerta falla (promesa rechazada)', async () => {
    alertsServiceMock.sendSecurityAlert.mockRejectedValue(new Error('Fallo simulado'));
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    
    const mockResponse = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const mockRequest = { url: '/test', method: 'GET', ip: '127.0.0.1' };
    const mockArgumentsHost = {
      switchToHttp: () => ({ getResponse: () => mockResponse, getRequest: () => mockRequest }),
    };

    filter.catch(exception, mockArgumentsHost as any);
    
    // Esperar a que la promesa del catch se resuelva
    await new Promise(resolve => setTimeout(resolve, 0));
    
    expect((filter as any).logger.error).toHaveBeenCalledWith('Error enviando alerta de seguridad', expect.any(Error));
  });

  it('debe manejar errores de validación (ej. 400) sin enviar alertas', () => {
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    
    const mockResponse = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const mockRequest = { url: '/test', method: 'GET', ip: '127.0.0.1' };
    const mockArgumentsHost = {
      switchToHttp: () => ({ getResponse: () => mockResponse, getRequest: () => mockRequest }),
    };

    filter.catch(exception, mockArgumentsHost as any);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect((filter as any).logger.log).toHaveBeenCalledWith(expect.stringContaining('Client Error [400]'));
    expect(alertsServiceMock.sendSecurityAlert).not.toHaveBeenCalled();
  });
});

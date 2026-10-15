import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClienteJwtService } from './cliente-jwt.service';
import {
  AUDIENCIA_CLIENTE,
  JWT_CLIENTE_SECRET_ENV,
  TIPO_TOKEN_CLIENTE,
} from './cliente-jwt.constants';

describe('ClienteJwtService', () => {
  let service: ClienteJwtService;
  const jwtService = {
    sign: jest.fn(),
    verifyAsync: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('cliente-secret'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configService.getOrThrow.mockReturnValue('cliente-secret');
    service = new ClienteJwtService(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('no exige el secreto al construir el servicio (validación perezosa)', () => {
    expect(configService.getOrThrow).not.toHaveBeenCalled();
  });

  describe('secreto ausente', () => {
    beforeEach(() => {
      configService.getOrThrow.mockImplementation(() => {
        throw new Error('JWT_CLIENTE_SECRET no está definido en el entorno');
      });
    });

    it('firmar falla de forma controlada (503) sin exponer detalles internos', () => {
      let capturado: unknown;
      try {
        service.firmar({ clienteId: 7, email: null, nombre: 'Ana' });
      } catch (error) {
        capturado = error;
      }

      expect(capturado).toBeInstanceOf(ServiceUnavailableException);
      const excepcion = capturado as ServiceUnavailableException;
      expect(excepcion.getStatus()).toBe(503);
      expect(JSON.stringify(excepcion.getResponse())).not.toContain(
        'JWT_CLIENTE_SECRET',
      );
    });

    it('verificar falla de forma controlada (503), no con un 401 engañoso', async () => {
      await expect(service.verificar('token')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('firmar', () => {
    it('resuelve el secreto perezosamente al firmar', () => {
      jwtService.sign.mockReturnValue('token-cliente');

      service.firmar({ clienteId: 7, email: 'ana@gmail.com', nombre: 'Ana' });

      expect(configService.getOrThrow).toHaveBeenCalledWith(
        JWT_CLIENTE_SECRET_ENV,
      );
    });

    it('firma con secreto, audiencia y tipo de cliente', () => {
      jwtService.sign.mockReturnValue('token-cliente');

      const resultado = service.firmar({
        clienteId: 7,
        email: 'ana@gmail.com',
        nombre: 'Ana',
      });

      expect(resultado).toBe('token-cliente');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: '7',
          clienteId: 7,
          tipo: TIPO_TOKEN_CLIENTE,
          email: 'ana@gmail.com',
          nombre: 'Ana',
        }),
        expect.objectContaining({
          secret: 'cliente-secret',
          audience: AUDIENCIA_CLIENTE,
        }),
      );
    });
  });

  describe('verificar', () => {
    it('devuelve la identidad de un token de cliente válido', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: '7',
        clienteId: 7,
        tipo: TIPO_TOKEN_CLIENTE,
        email: 'ana@gmail.com',
        nombre: 'Ana',
      });

      await expect(service.verificar('token')).resolves.toEqual({
        clienteId: 7,
        email: 'ana@gmail.com',
        nombre: 'Ana',
      });
    });

    it('rechaza un token inválido o expirado (401)', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

      await expect(service.verificar('token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rechaza un token cuyo tipo no es CLIENTE (p. ej. token de personal)', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: '1',
        id: 1,
        rol: 'SUPERADMIN',
        tipo: undefined,
      });

      await expect(service.verificar('token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rechaza un token sin identificador de cliente', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        tipo: TIPO_TOKEN_CLIENTE,
        sub: 'abc',
      });

      await expect(service.verificar('token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});

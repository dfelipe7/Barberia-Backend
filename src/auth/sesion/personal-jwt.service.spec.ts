import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PersonalJwtService } from './personal-jwt.service';
import { TIPO_TOKEN_PERSONAL } from './sesion-personal';

describe('PersonalJwtService', () => {
  let service: PersonalJwtService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verifyAsync: jest.fn(),
    } as any;

    configService = {
      get: jest.fn().mockReturnValue('secreto-de-prueba-muy-seguro'),
    } as any;

    service = new PersonalJwtService(jwtService, configService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('obtenerSecreto', () => {
    it('lanza ServiceUnavailableException si configService arroja un error', () => {
      configService.get.mockImplementation(() => {
        throw new Error('Config missing');
      });

      expect(() => service.firmar({ id: 1, sub: 'user-1' } as any)).toThrow(
        ServiceUnavailableException,
      );
    });

    it('lanza ServiceUnavailableException si JWT_SECRET no está configurado o está vacío', () => {
      configService.get.mockReturnValue('');
      expect(() => service.firmar({ id: 1, sub: 'user-1' } as any)).toThrow(
        ServiceUnavailableException,
      );

      configService.get.mockReturnValue(undefined as any);
      expect(() => service.firmar({ id: 1, sub: 'user-1' } as any)).toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('firmar', () => {
    it('firma agregando tipo: PERSONAL con el secreto obtenido', () => {
      const claims = { id: 1, sub: 'user-1', email: 'test@example.com' } as any;
      const token = service.firmar(claims);

      expect(configService.get).toHaveBeenCalledWith('JWT_SECRET');
      expect(jwtService.sign).toHaveBeenCalledWith(
        { ...claims, tipo: TIPO_TOKEN_PERSONAL },
        { secret: 'secreto-de-prueba-muy-seguro' },
      );
      expect(token).toBe('mock-jwt-token');
    });
  });

  describe('verificar', () => {
    it('lanza UnauthorizedException si la firma es invalida o expiro', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(service.verificar('token-invalido')).rejects.toThrow(
        new UnauthorizedException('Token inválido o expirado'),
      );
    });

    it('lanza UnauthorizedException si el tipo de token no es de personal', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        id: 1,
        sub: 'user-1',
        tipo: 'CLIENTE',
      });

      await expect(service.verificar('token-cliente')).rejects.toThrow(
        new UnauthorizedException(
          'El token no corresponde a una sesión de personal',
        ),
      );
    });

    it('retorna el payload si es valido y de tipo personal', async () => {
      const payload = {
        id: 1,
        sub: 'user-1',
        tipo: TIPO_TOKEN_PERSONAL,
      };
      jwtService.verifyAsync.mockResolvedValue(payload);

      const res = await service.verificar('token-valido');
      expect(res).toEqual(payload);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { KeycloakAuthGuard } from './keycloak-auth.guard';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

const mockJwtVerify = jest.fn();

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn().mockReturnValue({}),
  jwtVerify: (...args: unknown[]): unknown => mockJwtVerify(...args),
}));

const jwtVerifyMock = mockJwtVerify;

interface MockRequest {
  headers: Record<string, string>;
  user?: unknown;
}

describe('KeycloakAuthGuard', () => {
  let guard: KeycloakAuthGuard;
  let configServiceMock: Pick<ConfigService, 'getOrThrow' | 'get'>;

  beforeEach(async () => {
    configServiceMock = {
      getOrThrow: jest.fn((key: string): string => {
        if (key === 'KEYCLOAK_URL') return 'http://localhost:8080';
        if (key === 'KEYCLOAK_REALM') return 'barberia';
        return '';
      }),
      get: jest.fn((key: string): string | null => {
        if (key === 'KEYCLOAK_ISSUER') return 'http://localhost:8080';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakAuthGuard,
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    guard = module.get<KeycloakAuthGuard>(KeycloakAuthGuard);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(guard).toBeDefined();
  });

  it('debe lanzar UnauthorizedException si no hay authorization header', async () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('debe lanzar UnauthorizedException si el tipo de token no es Bearer', async () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Basic asdf' } }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('debe validar el token exitosamente', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'user-id' } });

    const mockRequest: MockRequest = {
      headers: { authorization: 'Bearer valid_token' },
    };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
    expect(mockRequest.user).toEqual({ sub: 'user-id' });
  });

  it('debe lanzar UnauthorizedException si el token es inválido', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('Invalid token'));

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer invalid_token' },
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

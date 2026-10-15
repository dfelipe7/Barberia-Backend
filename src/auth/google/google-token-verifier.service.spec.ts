import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { GoogleTokenVerifier } from './google-token-verifier.service';

describe('GoogleTokenVerifier', () => {
  let verifier: GoogleTokenVerifier;

  beforeEach(async () => {
    const mockConfigService = {
      getOrThrow: jest.fn().mockReturnValue('test-google-client-id'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleTokenVerifier,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    verifier = module.get<GoogleTokenVerifier>(GoogleTokenVerifier);
  });

  it('debe estar definido', () => {
    expect(verifier).toBeDefined();
  });

  it('devuelve el payload cuando el token es válido', async () => {
    jest
      .spyOn((verifier as any).oauthClient, 'verifyIdToken')
      .mockResolvedValue({
        getPayload: () => ({ sub: '123', email: 'cliente@gmail.com' }),
      } as any);

    await expect(verifier.verificar('token-valido')).resolves.toEqual({
      sub: '123',
      email: 'cliente@gmail.com',
    });
  });

  it('lanza UnauthorizedException si la verificación criptográfica falla', async () => {
    jest
      .spyOn((verifier as any).oauthClient, 'verifyIdToken')
      .mockRejectedValue(new Error('bad signature'));

    await expect(verifier.verificar('token-roto')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lanza UnauthorizedException si el payload no trae `sub`', async () => {
    jest
      .spyOn((verifier as any).oauthClient, 'verifyIdToken')
      .mockResolvedValue({
        getPayload: () => ({ email: 'sin-sub@gmail.com' }),
      } as any);

    await expect(verifier.verificar('token-sin-sub')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

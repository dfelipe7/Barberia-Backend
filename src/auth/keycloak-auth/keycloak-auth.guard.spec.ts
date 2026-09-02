import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KeycloakAuthGuard } from './keycloak-auth.guard';

describe('KeycloakAuthGuard', () => {
  it('should be defined', async () => {
    const module = await Test.createTestingModule({
      providers: [
        KeycloakAuthGuard,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              const values: Record<string, string> = {
                KEYCLOAK_URL: 'http://localhost:8080',
                KEYCLOAK_REALM: 'barberia',
              };
              return values[key];
            },
          },
        },
      ],
    }).compile();

    expect(module.get(KeycloakAuthGuard)).toBeDefined();
  });
});

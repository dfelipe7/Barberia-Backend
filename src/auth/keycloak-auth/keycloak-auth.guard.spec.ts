import { KeycloakAuthGuard } from './keycloak-auth.guard';

describe('KeycloakAuthGuard', () => {
  it('should be defined', () => {
    expect(new KeycloakAuthGuard()).toBeDefined();
  });
});

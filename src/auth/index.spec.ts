import * as authExports from './index';

describe('Auth index re-exports', () => {
  it('debe exportar los servicios, guards y controladores del módulo de autenticación', () => {
    expect(authExports.GoogleAuthService).toBeDefined();
    expect(authExports.GoogleLoginDto).toBeDefined();
    expect(authExports.JwtAuthGuard).toBeDefined();
    expect(authExports.RolesGuard).toBeDefined();
    expect(authExports.Roles).toBeDefined();
    expect(authExports.AuthController).toBeDefined();
    expect(authExports.AuthModule).toBeDefined();
    expect(authExports.GoogleTokenVerifier).toBeDefined();
    expect(authExports.ClientesAuthService).toBeDefined();
    expect(authExports.ClientesAuthController).toBeDefined();
    expect(authExports.ClientesAuthModule).toBeDefined();
    expect(authExports.ClienteJwtService).toBeDefined();
    expect(authExports.ClienteJwtAuthGuard).toBeDefined();
    expect(authExports.ClienteOpcionalJwtAuthGuard).toBeDefined();
  });
});

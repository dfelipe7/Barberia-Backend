import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClienteJwtService } from '../src/auth/clientes/cliente-jwt.service';
import {
  JWT_CLIENTE_SECRET_ENV,
  TIPO_TOKEN_CLIENTE,
} from '../src/auth/clientes/cliente-jwt.constants';
import { ClienteJwtAuthGuard } from '../src/auth/clientes/guards/cliente-jwt-auth.guard';
import { ClienteOpcionalJwtAuthGuard } from '../src/auth/clientes/guards/cliente-opcional-jwt-auth.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

/**
 * Prueba de criptografía REAL (sin mocks de `@nestjs/jwt`): este archivo vive
 * bajo `test/` y se ejecuta con `test/jest-e2e.json`, que no aplica el
 * `moduleNameMapper` que mockea `@nestjs/jwt` en los specs de `src/`.
 *
 * Comprueba que la separación cliente/personal se sostiene por firma, audiencia
 * y `tipo` de token, incluso si ambos secretos coincidieran por error de config.
 */
const SECRETO_PERSONAL = 'secreto-personal-de-prueba-e2e';
const SECRETO_CLIENTE = 'secreto-cliente-de-prueba-e2e';
const SECRETO_COMPARTIDO = 'secreto-compartido-por-error';

const configPara = (...secretos: string[]): ConfigService =>
  ({
    getOrThrow: (clave: string) => {
      if (clave === JWT_CLIENTE_SECRET_ENV && secretos[0] !== undefined) {
        return secretos[0];
      }
      throw new Error(`Configuración ausente: ${clave}`);
    },
  }) as unknown as ConfigService;

const crearContexto = (authorization?: string) => {
  const request: { headers: Record<string, string>; cliente?: unknown } = {
    headers: authorization ? { authorization } : {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
};

describe('Separación criptográfica de tokens (cliente vs personal)', () => {
  describe('con secretos distintos (configuración correcta)', () => {
    const jwtPersonal = new JwtService({ secret: SECRETO_PERSONAL });
    const jwtCliente = new JwtService();
    const clienteJwtService = new ClienteJwtService(
      jwtCliente,
      configPara(SECRETO_CLIENTE),
    );

    it('el token de cliente no supera el guard de personal', async () => {
      const token = clienteJwtService.firmar({
        clienteId: 7,
        email: 'ana@gmail.com',
        nombre: 'Ana',
      });
      const guard = new JwtAuthGuard(jwtPersonal);
      const { context } = crearContexto(`Bearer ${token}`);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('el token de personal no supera la verificación de cliente', async () => {
      const token = jwtPersonal.sign({ sub: '1', id: 1, rol: 'SUPERADMIN' });

      await expect(clienteJwtService.verificar(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('el token de cliente sí verifica contra su propio servicio', async () => {
      const token = clienteJwtService.firmar({
        clienteId: 42,
        email: 'ana@gmail.com',
        nombre: 'Ana',
      });

      await expect(clienteJwtService.verificar(token)).resolves.toEqual({
        clienteId: 42,
        email: 'ana@gmail.com',
        nombre: 'Ana',
      });
    });
  });

  describe('con el mismo secreto por error de configuración', () => {
    const jwtCompartido = new JwtService({ secret: SECRETO_COMPARTIDO });
    const clienteJwtService = new ClienteJwtService(
      jwtCompartido,
      configPara(SECRETO_COMPARTIDO),
    );

    it('el token de cliente rebota en el guard de personal por su `tipo`', async () => {
      const token = clienteJwtService.firmar({
        clienteId: 7,
        email: 'ana@gmail.com',
        nombre: 'Ana',
      });
      const guard = new JwtAuthGuard(jwtCompartido);
      const { context } = crearContexto(`Bearer ${token}`);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('el token de personal rebota en la verificación de cliente por su audiencia', async () => {
      const token = jwtCompartido.sign({ sub: '1', id: 1, rol: 'SUPERADMIN' });

      await expect(clienteJwtService.verificar(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('guards de cliente', () => {
    const jwtCliente = new JwtService();
    const clienteJwtService = new ClienteJwtService(
      jwtCliente,
      configPara(SECRETO_CLIENTE),
    );

    it('ClienteJwtAuthGuard publica la identidad y exige el token', async () => {
      const token = clienteJwtService.firmar({
        clienteId: 7,
        email: 'ana@gmail.com',
        nombre: 'Ana',
      });
      const guard = new ClienteJwtAuthGuard(clienteJwtService);

      const { context: sinToken } = crearContexto();
      await expect(guard.canActivate(sinToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      const { context, request } = crearContexto(`Bearer ${token}`);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.cliente).toEqual({
        clienteId: 7,
        email: 'ana@gmail.com',
        nombre: 'Ana',
      });
    });

    it('ClienteOpcionalJwtAuthGuard admite invitado pero no degrada un Bearer inválido', async () => {
      const guard = new ClienteOpcionalJwtAuthGuard(clienteJwtService);

      const { context: invitado } = crearContexto();
      await expect(guard.canActivate(invitado)).resolves.toBe(true);

      const tokenPersonal = jwtCliente.sign(
        { sub: '1', id: 1, rol: 'SUPERADMIN' },
        { secret: SECRETO_PERSONAL },
      );
      const { context: conPersonal } = crearContexto(`Bearer ${tokenPersonal}`);
      await expect(guard.canActivate(conPersonal)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('el payload firmado de cliente lleva tipo y audiencia correctos', () => {
      const token = clienteJwtService.firmar({
        clienteId: 5,
        email: null,
        nombre: 'Leo',
      });

      const payload = jwtCliente.verify<{ tipo?: string; aud?: string }>(
        token,
        { secret: SECRETO_CLIENTE },
      );
      expect(payload.tipo).toBe(TIPO_TOKEN_CLIENTE);
      expect(payload.aud).toBe('barberia-clientes');
    });
  });
});

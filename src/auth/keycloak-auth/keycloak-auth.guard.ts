import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';

@Injectable()
export class KeycloakAuthGuard implements CanActivate {
  private readonly jwks;

  constructor(
    private readonly configService: ConfigService,
  ) {
    const keycloakUrl =
      this.configService.getOrThrow<string>(
        'KEYCLOAK_URL',
      );

    const realm =
      this.configService.getOrThrow<string>(
        'KEYCLOAK_REALM',
      );

    this.jwks = createRemoteJWKSet(
      new URL(
        `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`,
      ),
    );
  }

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest();

    const authorization =
      request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException(
        'Token de autenticación requerido',
      );
    }

    const [type, token] =
      authorization.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException(
        'Formato de token inválido',
      );
    }

    try {
      const keycloakUrl =
        this.configService.getOrThrow<string>(
          'KEYCLOAK_URL',
        );

      const realm =
        this.configService.getOrThrow<string>(
          'KEYCLOAK_REALM',
        );

      const { payload } = await jwtVerify(
        token,
        this.jwks,
        {
          issuer: `${keycloakUrl}/realms/${realm}`,
        },
      );

      request.user = payload;

      return true;
    } catch {
      throw new UnauthorizedException(
        'Token inválido o expirado',
      );
    }
  }
}
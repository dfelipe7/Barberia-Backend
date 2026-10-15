import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

/**
 * Payload relevante de un ID Token de Google ya verificado criptográficamente.
 * Solo se tipan los campos que el backend consume; el resto se ignora.
 */
export interface PayloadGoogleVerificado {
  /** Identificador estable de la cuenta Google (`sub`). */
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

/**
 * Verificación criptográfica de ID Tokens de Google, compartida por el flujo de
 * personal (`GoogleAuthService`) y el de clientes (`ClientesAuthService`).
 *
 * Es responsabilidad ÚNICA de este servicio comprobar firma, emisor, audiencia y
 * expiración contra `GOOGLE_CLIENT_ID`. No decide autorización ni consulta la
 * base de datos: cada flujo aplica después sus propias reglas (el personal exige
 * rol activo; los clientes se dan de alta de forma idempotente).
 *
 * Ante cualquier fallo lanza `UnauthorizedException` sin exponer el detalle
 * criptográfico ni el token.
 */
@Injectable()
export class GoogleTokenVerifier {
  private readonly logger = new Logger(GoogleTokenVerifier.name);
  private readonly oauthClient: OAuth2Client;
  private readonly googleClientId: string;

  constructor(configService: ConfigService) {
    this.googleClientId = configService.getOrThrow<string>('GOOGLE_CLIENT_ID');
    this.oauthClient = new OAuth2Client(this.googleClientId);
  }

  async verificar(idToken: string): Promise<PayloadGoogleVerificado> {
    let payload: PayloadGoogleVerificado | undefined;

    try {
      const ticket = await this.oauthClient.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(
        `Token de Google inválido: ${(error as Error)?.message}`,
      );
      throw new UnauthorizedException(
        'El token de autenticación de Google es inválido o ha expirado.',
      );
    }

    if (!payload?.sub) {
      throw new UnauthorizedException(
        'El token de Google no contiene un identificador de cuenta válido.',
      );
    }

    return payload;
  }
}

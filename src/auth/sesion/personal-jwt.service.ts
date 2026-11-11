import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClaimsSesionPersonal, TIPO_TOKEN_PERSONAL } from './sesion-personal';

/**
 * Emisión y verificación de los tokens de sesión del PERSONAL.
 *
 * SEPARACIÓN CRIPTOGRÁFICA
 * --------------------------
 * El token de personal se firma con `JWT_SECRET` y el de clientes con
 * `JWT_CLIENTE_SECRET`: son secretos DISTINTOS, de modo que un token de una
 * clase nunca es aceptado por los guards de la otra, ni siquiera si una de
 * las dos claves se filtra. La marca `tipo` (`PERSONAL` / `CLIENTE`) es la
 * segunda barrera, semántica.
 *
 * SIN SECRETO DE RESPALDO
 * -----------------------
 * El secreto NO tiene valor por defecto: si `JWT_SECRET` falta en el
 * entorno, la autenticación falla de forma CONTROLADA (503) en lugar de
 * firmar con una clave conocida. La resolución es perezosa (en cada
 * operación), igual que en `ClienteJwtService`, para que la aplicación
 * pueda arrancar y solo fallen las rutas de autenticación.
 */
@Injectable()
export class PersonalJwtService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Devuelve el secreto de los tokens de personal.
   *
   * @throws ServiceUnavailableException si `JWT_SECRET` no está definido.
   */
  private obtenerSecreto(): string {
    let secreto: string | undefined;

    try {
      secreto = this.configService.get<string>('JWT_SECRET');
    } catch (error) {
      throw new ServiceUnavailableException(
        'El servicio de autenticación no está disponible',
        { cause: error },
      );
    }

    if (!secreto || secreto.trim().length === 0) {
      throw new ServiceUnavailableException(
        'El servicio de autenticación no está disponible',
      );
    }

    return secreto;
  }

  /**
   * Emite y firma un token JWT de sesión de personal con la marca `tipo: PERSONAL`.
   *
   * @remarks
   * La marca `tipo: PERSONAL` viaja en el payload del token y permite rechazar
   * tokens de clientes en rutas de gestión interna o personal administrativo.
   * La vigencia se toma de `JWT_EXPIRES_IN` (por defecto `7d`).
   *
   * @param claims - Datos de identidad, sede y roles a incrustar en el token.
   * @returns Token JWT serializado firmado con `JWT_SECRET`.
   * @throws {ServiceUnavailableException} Si la variable `JWT_SECRET` no está configurada.
   */
  firmar(claims: Omit<ClaimsSesionPersonal, 'tipo'>): string {
    const secreto = this.obtenerSecreto();

    return this.jwtService.sign(
      { ...claims, tipo: TIPO_TOKEN_PERSONAL },
      { secret: secreto },
    );
  }

  /**
   * Verifica la integridad de la firma HMAC, expiración y tipo del token de personal.
   *
   * @param token - Token recibido en la cabecera Authorization (Bearer).
   * @returns Claims validados de la sesión de personal.
   * @throws {UnauthorizedException} Si el token es inválido, expiró o no pertenece a la clase personal.
   * @throws {ServiceUnavailableException} Si el secreto de personal no está configurado.
   */
  async verificar(token: string): Promise<ClaimsSesionPersonal> {
    const secreto = this.obtenerSecreto();

    let payload: ClaimsSesionPersonal;

    try {
      payload = await this.jwtService.verifyAsync<ClaimsSesionPersonal>(token, {
        secret: secreto,
      });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (payload.tipo !== TIPO_TOKEN_PERSONAL) {
      throw new UnauthorizedException(
        'El token no corresponde a una sesión de personal',
      );
    }

    return payload;
  }
}

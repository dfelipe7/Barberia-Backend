import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AUDIENCIA_CLIENTE,
  EXPIRACION_TOKEN_CLIENTE,
  JWT_CLIENTE_SECRET_ENV,
  TIPO_TOKEN_CLIENTE,
} from './cliente-jwt.constants';

/**
 * Identidad de un cliente autenticado ya verificada a partir de su token.
 * `clienteId` proviene de la base de datos (nunca del frontend).
 */
export interface ClienteAutenticado {
  clienteId: number;
  email: string | null;
  nombre: string;
  /**
   * Barbería a la que queda vinculada la sesión del cliente.
   *
   * El token de cliente se ata al negocio en el que se inició sesión: el
   * cliente de una barbería no puede usar su token en otra.
   */
  negocioId: number | null;
}

/** Datos con los que se emite la sesión de un cliente. */
export interface SesionCliente {
  clienteId: number;
  email: string | null;
  nombre: string;
  /** Barbería a la que queda vinculada la sesión. */
  negocioId: number | null;
}

/** Reclamaciones mínimas esperadas en un token de cliente. */
interface PayloadTokenCliente {
  sub?: string | number;
  clienteId?: number;
  tipo?: string;
  email?: string | null;
  nombre?: string;
  negocioId?: number;
}

/**
 * Emisión y verificación de la sesión de cliente, aislada de la del personal.
 *
 * El secreto se lee de `JWT_CLIENTE_SECRET` con `getOrThrow` de forma PEREZOSA
 * (al firmar/verificar, no al construir el servicio), de modo que un secreto
 * ausente no impide arrancar la aplicación: solo deja inservibles las rutas de
 * cliente, que fallan de forma segura. Nunca se degrada a `JWT_SECRET` ni a un
 * valor por defecto. Esa separación garantiza que un token de cliente no pueda
 * reutilizarse contra las rutas de personal ni al revés, incluso si una de las
 * dos claves se filtra.
 */
@Injectable()
export class ClienteJwtService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Obtiene el secreto exclusivo de clientes. Si la configuración está
   * incompleta, conserva el error interno (como `cause`) pero responde de forma
   * controlada y neutra, sin exponer detalles sensibles ni transformarse en un
   * 401 engañoso.
   */
  private obtenerSecreto(): string {
    try {
      return this.configService.getOrThrow<string>(JWT_CLIENTE_SECRET_ENV);
    } catch (error) {
      throw new ServiceUnavailableException(
        'El servicio de autenticación de clientes no está disponible',
        { cause: error },
      );
    }
  }

  /** Firma el token de sesión del cliente con su secreto y audiencia propios. */
  firmar(sesion: SesionCliente): string {
    const secret = this.obtenerSecreto();

    return this.jwtService.sign(
      {
        sub: String(sesion.clienteId),
        clienteId: sesion.clienteId,
        tipo: TIPO_TOKEN_CLIENTE,
        email: sesion.email,
        nombre: sesion.nombre,
        negocioId: sesion.negocioId,
      },
      {
        secret,
        audience: AUDIENCIA_CLIENTE,
        expiresIn: EXPIRACION_TOKEN_CLIENTE,
      },
    );
  }

  /**
   * Verifica firma, expiración, audiencia y tipo del token de cliente.
   * Un token de personal (sin audiencia de cliente, o firmado con otro secreto)
   * NO supera esta verificación.
   *
   * @throws UnauthorizedException si el token es inválido o no es de cliente.
   */
  async verificar(token: string): Promise<ClienteAutenticado> {
    const secret = this.obtenerSecreto();

    let payload: PayloadTokenCliente;

    try {
      payload = await this.jwtService.verifyAsync<PayloadTokenCliente>(token, {
        secret,
        audience: AUDIENCIA_CLIENTE,
      });
    } catch {
      throw new UnauthorizedException('Token de cliente inválido o expirado');
    }

    if (payload.tipo !== TIPO_TOKEN_CLIENTE) {
      throw new UnauthorizedException(
        'El token no corresponde a una sesión de cliente',
      );
    }

    const clienteId = Number(payload.clienteId ?? payload.sub);
    if (!Number.isInteger(clienteId) || clienteId <= 0) {
      throw new UnauthorizedException(
        'El token de cliente no identifica a un cliente válido',
      );
    }

    return {
      clienteId,
      email: payload.email ?? null,
      nombre: payload.nombre ?? '',
      negocioId:
        typeof payload.negocioId === 'number' &&
        Number.isInteger(payload.negocioId)
          ? payload.negocioId
          : null,
    };
  }
}

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { GoogleTokenVerifier } from '../google/google-token-verifier.service';
import { ClientesRepository } from '../../modules/reservas/repository/clientes.repository';
import { ClienteJwtService } from './cliente-jwt.service';
import { ClienteSesionResponseDto } from './dto/cliente-sesion-response.dto';

/**
 * Autenticación de clientes con Google (HE-04, Modalidad B).
 *
 * Reutiliza la verificación criptográfica de Google (`GoogleTokenVerifier`) pero
 * NO la autorización del personal: cualquier cuenta de Google con correo
 * verificado puede ser cliente; no requiere estar registrada ni tener rol.
 *
 * La identidad se ancla en `Cliente.googleId` (el `sub` del token). El alta es
 * idempotente: el mismo `googleId` siempre resuelve al mismo cliente. Nunca se
 * confía en un `clienteId`, correo o `googleId` enviado por el frontend: todo se
 * deriva de la verificación del token de Google y de la base de datos.
 */
@Injectable()
export class ClientesAuthService {
  private readonly logger = new Logger(ClientesAuthService.name);

  constructor(
    private readonly googleTokenVerifier: GoogleTokenVerifier,
    private readonly clientesRepository: ClientesRepository,
    private readonly clienteJwtService: ClienteJwtService,
  ) {}

  async loginConGoogle(idToken: string): Promise<ClienteSesionResponseDto> {
    const payload = await this.googleTokenVerifier.verificar(idToken);

    if (!payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException(
        'La cuenta de Google debe tener un correo electrónico verificado.',
      );
    }

    const email = payload.email.toLowerCase().trim();
    const nombre = (payload.given_name ?? payload.name ?? email).trim();
    const apellido = payload.family_name?.trim() || null;

    const cliente = await this.clientesRepository.buscarOcrearPorGoogle({
      googleId: payload.sub,
      email,
      nombre,
      apellido,
    });

    const accessToken = this.clienteJwtService.firmar({
      clienteId: cliente.id,
      email: cliente.email,
      nombre: cliente.nombre,
    });

    this.logger.log(`LOGIN CLIENTE: clienteId=${cliente.id}`);

    return {
      accessToken,
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        apellido: cliente.apellido,
        email: cliente.email,
      },
    };
  }
}

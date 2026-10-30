import {
  Injectable,
  Logger,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { GoogleTokenVerifier } from '../google/google-token-verifier.service';
import { ClientesRepository } from '../../modules/reservas/repository/clientes.repository';
import { ClienteJwtService } from './cliente-jwt.service';
import { ClienteSesionResponseDto } from './dto/cliente-sesion-response.dto';
import { ActualizarPerfilClienteDto } from './dto/actualizar-perfil-cliente.dto';
import { NegocioContextoService } from '../../modules/negocios/negocio-contexto.service';

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
    private readonly contextoService: NegocioContextoService,
  ) {}

  async loginConGoogle(idToken: string): Promise<ClienteSesionResponseDto> {
    const payload = await this.googleTokenVerifier.verificar(idToken);

    if (!payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException(
        'La cuenta de Google debe tener un correo electrónico verificado.',
      );
    }

    const contexto = this.contextoService.obtenerContexto();

    if (!contexto) {
      throw new ForbiddenException(
        'No se pudo determinar la barbería de la sesión. Accede desde el dominio de tu barbería.',
      );
    }

    const email = payload.email.toLowerCase().trim();
    const nombre = (payload.given_name ?? payload.name ?? email).trim();
    const apellido = payload.family_name?.trim() || null;

    let cliente: {
      id: number;
      nombre: string;
      apellido: string | null;
      email: string | null;
      negocioId: number | null;
    };

    try {
      cliente = await this.clientesRepository.buscarOcrearPorGoogle({
        googleId: payload.sub,
        email,
        nombre,
        apellido,
      });
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'P2002') {
        // `Cliente.googleId` es ÚNICO GLOBAL: la misma cuenta de Google no
        // puede tener ficha en dos barberías hasta que la fase 8 sustituya la
        // clave por la compuesta `(googleId, negocioId)`. Se responde con un
        // conflicto explícito en lugar de un error interno.
        throw new ConflictException(
          'Esta cuenta ya está registrada en otra barbería. La inscripción simultánea en varias barberías se habilitará en la fase 8.',
        );
      }
      throw error;
    }

    const accessToken = this.clienteJwtService.firmar({
      clienteId: cliente.id,
      email: cliente.email,
      nombre: cliente.nombre,
      negocioId: cliente.negocioId ?? contexto.id,
    });

    this.logger.log(
      `LOGIN CLIENTE: clienteId=${cliente.id} negocio=${contexto.slug}`,
    );

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
  async obtenerPerfil(clienteId: number) {
    const perfil = await this.clientesRepository.obtenerPorId(clienteId);
    if (!perfil) {
      throw new NotFoundException('Cliente no encontrado en esta barbería');
    }
    return {
      id: perfil.id,
      nombre: perfil.nombre,
      apellido: perfil.apellido,
      email: perfil.email,
      telefono: perfil.telefono,
    };
  }

  async actualizarPerfil(clienteId: number, dto: ActualizarPerfilClienteDto) {
    const cliente = await this.clientesRepository.obtenerPorId(clienteId);
    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado en esta barbería');
    }

    return this.clientesRepository.actualizarPerfil(clienteId, {
      telefono: dto.telefono !== undefined ? (dto.telefono ? dto.telefono.trim() : null) : undefined,
      nombre: dto.nombre ? dto.nombre.trim() : undefined,
      apellido: dto.apellido !== undefined ? (dto.apellido ? dto.apellido.trim() : null) : undefined,
    });
  }
}

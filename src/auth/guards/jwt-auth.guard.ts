import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { PersonalJwtService } from '../sesion/personal-jwt.service';
import { ClaimsSesionPersonal } from '../sesion/sesion-personal';
import { NegocioContextoService } from '../../modules/negocios/negocio-contexto.service';

/**
 * Guard de Autenticación JWT del PERSONAL (barbería).
 *
 * Valida el token y, sobre todo, COMPRUEBA QUE LA SESIÓN PERTENEZCA AL
 * NEGOCIO DE LA PETICIÓN.
 *
 * POR QUÉ NO BASTA CON VERIFICAR LA FIRMA
 * ----------------------------------------
 * Un token válido dice "esta persona tiene estos roles en el negocio X". Si
 * la petición se hace en el negocio Y, el token de X no debe servir: el
 * `negocioId` del token se compara con el contexto de negocio RESUELTO por el
 * servidor (subdominio o `X-Negocio-Slug`), nunca con algo que envíe el
 * cliente. Cambiar la cabecera NO cambia el negocio autorizado: produce un
 * 403, nunca un acceso wider.
 *
 * TOKENS SIN NEGOCIO
 * ------------------
 * Los tokens emitidos antes de esta fase (sin `negocioId`) y las sesiones
 * globales de plataforma NO son sesiones operativas: se rechazan. No se les
 * asigna el negocio inicial ni el de la cabecera como rescate: el usuario
 * debe volver a iniciar sesión (o hacer el cambio explícito de negocio).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly personalJwt: PersonalJwtService,
    private readonly contextoService: NegocioContextoService,
  ) {}

  /**
   * Valida la autenticidad del token Bearer JWT y verifica el aislamiento multitenant.
   *
   * @remarks
   * Principio Zero-Trust Multitenant:
   * No es suficiente con que el token esté válidamente firmado por la clave secreta.
   * Se comprueba obligatoriamente que el `negocioId` contenido en los claims del token
   * coincida exactamente con el `negocioId` resuelto en el contexto de la petición (`AsyncLocalStorage`).
   * Un intento de usar un token de la barbería A en la barbería B es rechazado con 403 Forbidden.
   *
   * @param context - Contexto de ejecución de la petición entrante de NestJS.
   * @returns Promesa que resuelve `true` si la sesión es válida y pertenece al negocio activo.
   * @throws {UnauthorizedException} Si no se proporciona token, si está expirado o no tiene sede asignada.
   * @throws {ForbiddenException} Si el token pertenece a otra sede o no hay contexto de sede autorizado.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: ClaimsSesionPersonal;
    }>();
    const authorization = request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException('Token de autenticación requerido');
    }

    const [type, token] = authorization.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Formato de token inválido');
    }

    let payload: ClaimsSesionPersonal;

    try {
      payload = await this.personalJwt.verificar(token);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (payload.ambito !== 'NEGOCIO' || !payload.negocioId) {
      throw new UnauthorizedException(
        'La sesión no está vinculada a un negocio: inicia sesión de nuevo',
      );
    }

    const contexto = this.contextoService.obtenerContexto();

    if (!contexto) {
      throw new ForbiddenException(
        'La petición no tiene un contexto de negocio autorizado',
      );
    }

    if (contexto.id !== payload.negocioId) {
      throw new ForbiddenException(
        'La sesión pertenece a otro negocio: no puede operar en este',
      );
    }

    request.user = payload;

    return true;
  }
}

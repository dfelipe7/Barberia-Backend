/**
 * Respuesta HTTP mínima que usa el filtro.
 *
 * Se declara para no trabajar con `any`: el filtro solo usa `status`, `json` y
 * (opcionalmente) `setHeader`.
 */
interface RespuestaDelFiltro {
  status: (codigo: number) => RespuestaDelFiltro;
  json: (cuerpo: unknown) => void;
  setHeader?: (nombre: string, valor: string) => void;
}

/**
 * Trazabilidad:
 * - REQ: REQ-009, REQ-010
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: registrar y notificar errores sin filtrar credenciales al logger ni al correo de alerta.
 * - Responsabilidad: formato de la respuesta de error y decisión de notificar. No conoce credenciales ni reglas de negocio.
 */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AlertsService } from '../modules/alerts/alerts.service';
import {
  construirContextoSeguro,
  PeticionSeguro,
} from './sanitizar-contexto-error';

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly alertsService: AlertsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<RespuestaDelFiltro>();
    const request = ctx.getRequest<PeticionSeguro>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const responseObject =
      typeof rawResponse === 'object' && rawResponse !== null
        ? (rawResponse as Record<string, unknown>)
        : undefined;

    const message =
      responseObject && 'message' in responseObject
        ? responseObject.message
        : rawResponse;

    const code = responseObject?.code;
    const details = responseObject?.details;

    // Identificador de la petición: permite correlacionar el log, el correo de
    // alerta y la respuesta que ve el cliente.
    const requestId = randomUUID();

    // El contexto que se registra y se envía por correo NO incluye el cuerpo de
    // la petición: ahí viajan el ID token de Google, las contraseñas y los
    // datos de acceso. Tampoco se incluyen cabeceras ni cookies.
    const logContext = construirContextoSeguro(request, {
      status,
      message,
      codigoError: typeof code === 'string' ? code : undefined,
      requestId,
    });

    response.setHeader?.('X-Request-Id', requestId);

    // OWASP A09: Monitoreo de Seguridad (Alertas Tempranas)
    // Si es 401 o 403, lo registramos como una Advertencia (warn) de seguridad
    if (status === 401 || status === 403) {
      this.logger.warn(
        `Security Event [${status}]: Intento de acceso denegado`,
        logContext,
      );

      // OWASP A09: Evitar fatiga de alertas. Solo enviar correo si es intento de violación de roles (403).
      // Los 401 (sesión expirada) se guardan en el log físico pero no envían correo.
      if (status === 403) {
        this.alertsService
          .sendSecurityAlert(status, logContext)
          .catch((err) => {
            this.logger.error('Error enviando alerta de seguridad', err);
          });
      }
    }
    // Si es un error 500 o fallos de DB, lo registramos como Error Crítico
    else if (status >= 500) {
      this.logger.error(
        `Critical Error [${status}]: Fallo en el servidor`,
        exception instanceof Error ? exception.stack : '',
        logContext,
      );
      // Disparar correo de alerta para caídas del servidor
      this.alertsService.sendSecurityAlert(status, logContext).catch((err) => {
        this.logger.error('Error enviando alerta de seguridad', err);
      });
    }
    // Errores de validación o conflicto (400, 409) son menos graves pero los logueamos
    else {
      this.logger.log(
        `Client Error [${status}]: Petición rechazada - Path: ${logContext.path}`,
      );
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      // La ruta va SANEADA: si el secreto viaja en la query string, la
      // respuesta no lo devuelve (antes sí, y el log no).
      path: logContext.path,
      message,
      ...(code === undefined ? {} : { code }),
      ...(details === undefined ? {} : { details }),
    });
  }
}

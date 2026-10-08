import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { AlertsService } from '../modules/alerts/alerts.service';

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly alertsService: AlertsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const logContext = {
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      ip: request.ip,
      body: request.body, // Opcional, con cuidado en prod
      user: request.user?.sub, // Si hay usuario de Keycloak
      message,
    };

    // OWASP A09: Monitoreo de Seguridad (Alertas Tempranas)
    // Si es 401 o 403, lo registramos como una Advertencia (warn) de seguridad
    if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
      this.logger.warn(`Security Event [${status}]: Intento de acceso denegado`, logContext);
      
      // OWASP A09: Evitar fatiga de alertas. Solo enviar correo si es intento de violación de roles (403).
      // Los 401 (sesión expirada) se guardan en el log físico pero no envían correo.
      if (status === HttpStatus.FORBIDDEN) {
        this.alertsService.sendSecurityAlert(status, logContext).catch((err) => {
          this.logger.error('Error enviando alerta de seguridad', err);
        });
      }
    } 
    // Si es un error 500 o fallos de DB, lo registramos como Error Crítico
    else if (status >= 500) {
      this.logger.error(`Critical Error [${status}]: Fallo en el servidor`, exception instanceof Error ? exception.stack : '', logContext);
      // Disparar correo de alerta para caídas del servidor
      this.alertsService.sendSecurityAlert(status, logContext).catch((err) => {
        this.logger.error('Error enviando alerta de seguridad', err);
      });
    } 
    // Errores de validación o conflicto (400, 409) son menos graves pero los logueamos
    else {
      this.logger.log(`Client Error [${status}]: Petición rechazada - Path: ${request.url}`);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}

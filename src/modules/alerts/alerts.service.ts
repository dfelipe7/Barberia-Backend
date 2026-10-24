/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: enviar la alerta de seguridad sin filtrar credenciales al correo.
 * - Responsabilidad: contenido del correo de alerta. No decide qué errores se notifican.
 */
import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

/**
 * Campos que el correo de alerta puede incluir.
 *
 * Es una LISTA BLANTA y no un volcado del contexto: así, aunque el llamador
 * pase el cuerpo de la petición o una cabecera de autorización, el correo no
 * puede arrastrar credenciales.
 */
export interface CamposAlerta {
  timestamp?: string;
  method?: string;
  path?: string;
  status?: number;
  requestId?: string;
  codigoError?: string;
  ip?: string;
  user?: string;
  message?: unknown;
}

/**
 * Extrae del contexto únicamente los campos permitidos.
 *
 * @param contextInfo Contexto del error, con la forma que sea.
 * @returns Objeto con los campos permitidos que estén presentes.
 */
export function extraerCamposPermitidos(contextInfo: unknown): CamposAlerta {
  const origen = (contextInfo ?? {}) as Record<string, unknown>;

  const texto = (clave: string): string | undefined => {
    const valor = origen[clave];
    if (valor === undefined || valor === null) {
      return undefined;
    }
    if (typeof valor === 'string') {
      return valor;
    }
    if (typeof valor === 'number' || typeof valor === 'boolean') {
      return String(valor);
    }
    // Un objeto no se serializa a texto: podría esconder datos.
    return undefined;
  };

  return {
    timestamp: texto('timestamp'),
    method: texto('method'),
    path: texto('path'),
    status: origen.status === undefined ? undefined : Number(origen.status),
    requestId: texto('requestId'),
    codigoError: texto('codigoError'),
    ip: texto('ip'),
    user: texto('user'),
    message: origen.message,
  };
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendSecurityAlert(statusCode: number, contextInfo: any) {
    try {
      // Solo se envía lo permitido: el correo nunca arrastra el cuerpo de la
      // petición ni cabeceras de autenticación.
      const campos = extraerCamposPermitidos(contextInfo);
      const adminEmail =
        process.env.SUPERADMIN_EMAIL || 'armeroduvan8@gmail.com';

      await this.mailerService.sendMail({
        to: adminEmail,
        subject: `⚠️ ALERTA DE SEGURIDAD - Barbería VIP [Error ${statusCode}]`,
        text: `Se ha detectado un evento de seguridad crítico en el sistema.\n\nDetalles:\n${JSON.stringify(campos, null, 2)}`,
        html: `
          <h2 style="color: red;">Alerta de Seguridad Crítica</h2>
          <p>El escudo del servidor ha detectado un fallo grave o un posible intento de intrusión.</p>
          <ul>
            <li><strong>Código de Error:</strong> ${statusCode}</li>
            <li><strong>IP de origen:</strong> ${campos.ip ?? '-'}</li>
            <li><strong>Ruta atacada/fallida:</strong> ${campos.path ?? '-'}</li>
            <li><strong>Método:</strong> ${campos.method ?? '-'}</li>
            <li><strong>Fecha:</strong> ${campos.timestamp ?? '-'}</li>
            <li><strong>Identificador de petición:</strong> ${campos.requestId ?? '-'}</li>
            <li><strong>Código de error:</strong> ${campos.codigoError ?? statusCode}</li>
          </ul>
          <p>Se ha guardado una copia permanente de este registro en la caja negra del servidor (<strong>logs/security.log</strong>).</p>
          <hr/>
          <p><small>Este es un mensaje automático del Sistema de Auditoría OWASP (A09).</small></p>
        `,
      });
      this.logger.log(
        'Correo electrónico de alerta de seguridad enviado con éxito.',
      );
    } catch (error) {
      this.logger.error(
        'No se pudo enviar el correo de alerta de seguridad. Revisa las credenciales de Nodemailer en el .env',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

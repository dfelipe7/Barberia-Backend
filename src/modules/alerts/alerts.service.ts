import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendSecurityAlert(statusCode: number, contextInfo: any) {
    try {
      const adminEmail =
        process.env.SUPERADMIN_EMAIL || 'armeroduvan8@gmail.com';

      await this.mailerService.sendMail({
        to: adminEmail,
        subject: `⚠️ ALERTA DE SEGURIDAD - Barbería VIP [Error ${statusCode}]`,
        text: `Se ha detectado un evento de seguridad crítico en el sistema.\n\nDetalles:\n${JSON.stringify(contextInfo, null, 2)}`,
        html: `
          <h2 style="color: red;">Alerta de Seguridad Crítica</h2>
          <p>El escudo del servidor ha detectado un fallo grave o un posible intento de intrusión.</p>
          <ul>
            <li><strong>Código de Error:</strong> ${statusCode}</li>
            <li><strong>IP de origen:</strong> ${contextInfo.ip}</li>
            <li><strong>Ruta atacada/fallida:</strong> ${contextInfo.path}</li>
            <li><strong>Método:</strong> ${contextInfo.method}</li>
            <li><strong>Fecha:</strong> ${contextInfo.timestamp}</li>
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

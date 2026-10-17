import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Boom } from '@hapi/boom';
import { PrismaService } from '../../prisma/prisma.service';
import { ActualizarPlantillasDto } from './dto/actualizar-plantillas.dto';

// Filtro para silenciar el log interno de depuración de libsignal ("Closing session: SessionEntry")
const originalConsoleInfo = console.info;
console.info = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Closing session:') || args[0].includes('Closing open session'))
  ) {
    return;
  }
  originalConsoleInfo(...args);
};

const originalConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Closing session:') || args[0].includes('Closing open session'))
  ) {
    return;
  }
  originalConsoleWarn(...args);
};

export const PLANTILLA_CONFIRMACION_DEFAULT =
  `💈 *KYRIOS BARBER STUDIO*\n` +
  `¡Hola {cliente}! Tu cita ha sido agendada con éxito.\n\n` +
  `📅 *Fecha:* {fecha}\n` +
  `⏰ *Hora:* {hora}\n` +
  `✂️ *Servicio:* {servicio}\n` +
  `💈 *Barbero:* {barbero}` +
  `{precio}` +
  `\n\n📍 *Ubicación:* {ubicacion}\n` +
  `_Te esperamos 5 minutos antes de tu cita. ¡Gracias por elegirnos!_`;

export const PLANTILLA_RECORDATORIO_DEFAULT =
  `⏰ *RECORDATORIO DE TU CITA - KYRIOS BARBER*\n` +
  `¡Hola {cliente}! Te recordamos que tienes una cita programada para hoy:\n\n` +
  `⏰ *Hora:* {hora}\n` +
  `✂️ *Servicio:* {servicio}\n` +
  `💈 *Barbero:* {barbero}\n\n` +
  `📍 *Ubicación:* {ubicacion}\n` +
  `_Si no puedes asistir o necesitas reprogramar, por favor avísanos con tiempo._`;

export interface DatosConfirmacionWhatsApp {
  telefono: string;
  clienteNombre: string;
  servicioNombre: string;
  barberoNombre: string;
  fecha: string;
  hora: string;
  precio?: number | string | null;
}

@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private sock: WASocket | null = null;
  private isConnected = false;
  private qrDataUrl: string | null = null;
  private readonly sessionDir: string;
  private isIntentionalDisconnect = false;

  constructor(@Optional() private readonly prisma?: PrismaService) {
    this.sessionDir =
      process.env.WHATSAPP_SESSION_PATH ||
      path.join(os.homedir(), '.kyrios_whatsapp_session');
  }

  async onModuleInit() {
    this.logger.log(`Iniciando servicio de WhatsApp con sesión en: ${this.sessionDir}`);
    await this.iniciarSocket();
  }

  async onModuleDestroy() {
    this.destruirSocket();
  }

  private destruirSocket() {
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.end(undefined);
      } catch (err) {
        this.logger.warn(`Error cerrando socket anterior: ${err}`);
      }
      this.sock = null;
    }
  }

  async iniciarSocket() {
    this.destruirSocket();

    try {
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }) as any,
        printQRInTerminal: false,
        browser: ['Kyrios Barber Studio', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60_000,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, {
              width: 320,
              margin: 2,
              color: { dark: '#0C0C0C', light: '#FFFFFF' },
            });
            this.isConnected = false;
            this.logger.log('Nuevo código QR de WhatsApp generado y listo para escanear.');
          } catch (err) {
            this.logger.error('Error convirtiendo QR a imagen DataURL', err);
          }
        }

        if (connection === 'open') {
          this.isConnected = true;
          this.qrDataUrl = null;
          this.isIntentionalDisconnect = false;
          this.logger.log('🟢 CONEXIÓN ESTABLECIDA CON WHATSAPP WEB.');
        }

        if (connection === 'close') {
          this.isConnected = false;
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.logger.warn(
            `Conexión cerrada con WhatsApp. Código de salida: ${statusCode}. Reconectar: ${shouldReconnect}`,
          );

          if (statusCode === DisconnectReason.connectionReplaced) {
            this.logger.warn(
              'La sesión de WhatsApp fue abierta en otro lugar o navegador (440). No se reintentará automáticamente.',
            );
            return;
          }

          if (statusCode === DisconnectReason.loggedOut || this.isIntentionalDisconnect) {
            this.logger.log('Sesión cerrada o desvinculada. Limpiando credenciales locales...');
            this.limpiarCarpetaSesion();
            setTimeout(() => this.iniciarSocket(), 2000);
            return;
          }

          if (shouldReconnect) {
            setTimeout(() => this.iniciarSocket(), 4000);
          }
        }
      });
    } catch (error) {
      this.logger.error('Error fatal inicializando Baileys WhatsApp Socket:', error);
    }
  }

  private limpiarCarpetaSesion() {
    try {
      if (fs.existsSync(this.sessionDir)) {
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
        this.logger.log(`Carpeta de sesión eliminada con éxito: ${this.sessionDir}`);
      }
    } catch (err) {
      this.logger.error('Error eliminando carpeta de sesión de WhatsApp:', err);
    }
  }

  getStatus(): { conectado: boolean; qr: string | null } {
    return {
      conectado: this.isConnected,
      qr: this.isConnected ? null : this.qrDataUrl,
    };
  }

  async desconectar(): Promise<{ mensaje: string }> {
    this.isIntentionalDisconnect = true;
    this.isConnected = false;
    this.qrDataUrl = null;

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (err) {
        this.logger.warn(`Error enviando logout a WhatsApp: ${err}`);
      }
    }

    this.destruirSocket();
    this.limpiarCarpetaSesion();

    setTimeout(() => {
      this.iniciarSocket();
    }, 1500);

    return { mensaje: 'WhatsApp desvinculado con éxito. Se generará un nuevo QR.' };
  }

  /**
   * Normaliza un número telefónico a formato internacional JID de WhatsApp.
   * Por defecto asume código de país Colombia (+57) para números celulares de 10 dígitos.
   */
  formatearNumeroAJid(telefono: string): string | null {
    if (!telefono) return null;
    const limpio = telefono.replace(/\D/g, '');

    if (limpio.length === 10 && limpio.startsWith('3')) {
      return `57${limpio}@s.whatsapp.net`;
    }

    if (limpio.length === 12 && limpio.startsWith('573')) {
      return `${limpio}@s.whatsapp.net`;
    }

    if (limpio.length >= 8) {
      return `${limpio}@s.whatsapp.net`;
    }

    return null;
  }

  async enviarMensaje(telefono: string, texto: string): Promise<boolean> {
    if (!this.isConnected || !this.sock) {
      this.logger.warn(`No se envió el mensaje a ${telefono}: WhatsApp no está conectado.`);
      return false;
    }

    const jid = this.formatearNumeroAJid(telefono);
    if (!jid) {
      this.logger.warn(`Teléfono inválido para WhatsApp: ${telefono}`);
      return false;
    }

    try {
      await this.sock.sendMessage(jid, { text: texto });
      this.logger.log(`Mensaje de WhatsApp enviado exitosamente a ${jid}`);
      return true;
    } catch (error) {
      this.logger.error(`Error enviando mensaje por WhatsApp a ${jid}:`, error);
      return false;
    }
  }

  /**
   * Reemplaza las variables dinámicas de una plantilla con los datos reales de la reserva.
   */
  reemplazarVariables(
    plantilla: string,
    datos: DatosConfirmacionWhatsApp,
  ): string {
    const precioTexto = datos.precio
      ? `\n💰 *Valor:* $${Number(datos.precio).toLocaleString('es-CO')}`
      : '';

    return plantilla
      .replace(/{cliente}/g, datos.clienteNombre)
      .replace(/{servicio}/g, datos.servicioNombre)
      .replace(/{barbero}/g, datos.barberoNombre)
      .replace(/{fecha}/g, datos.fecha)
      .replace(/{hora}/g, datos.hora)
      .replace(/{precio}/g, precioTexto)
      .replace(/{ubicacion}/g, 'Carrera 6 # 3-45, Centro Histórico, Popayán');
  }

  /**
   * Obtiene las plantillas de mensajes configuradas en la base de datos o retorna las predeterminadas.
   */
  async obtenerPlantillas(): Promise<{ confirmacion: string; recordatorio: string }> {
    if (!this.prisma) {
      return {
        confirmacion: PLANTILLA_CONFIRMACION_DEFAULT,
        recordatorio: PLANTILLA_RECORDATORIO_DEFAULT,
      };
    }

    try {
      const plantillasDb = await this.prisma.whatsAppPlantilla.findMany({
        where: { tipo: { in: ['CONFIRMACION', 'RECORDATORIO'] }, activo: true },
      });

      const confirmacion =
        plantillasDb.find((p) => p.tipo === 'CONFIRMACION')?.mensaje ||
        PLANTILLA_CONFIRMACION_DEFAULT;

      const recordatorio =
        plantillasDb.find((p) => p.tipo === 'RECORDATORIO')?.mensaje ||
        PLANTILLA_RECORDATORIO_DEFAULT;

      return { confirmacion, recordatorio };
    } catch (err) {
      this.logger.warn(`Error leyendo plantillas de BD, usando valores por defecto: ${err}`);
      return {
        confirmacion: PLANTILLA_CONFIRMACION_DEFAULT,
        recordatorio: PLANTILLA_RECORDATORIO_DEFAULT,
      };
    }
  }

  /**
   * Actualiza o crea las plantillas de mensajes en la base de datos.
   */
  async guardarPlantillas(
    dto: ActualizarPlantillasDto,
  ): Promise<{ confirmacion: string; recordatorio: string }> {
    if (this.prisma) {
      if (dto.confirmacion !== undefined && dto.confirmacion.trim() !== '') {
        await this.prisma.whatsAppPlantilla.upsert({
          where: { tipo: 'CONFIRMACION' },
          update: { mensaje: dto.confirmacion.trim(), activo: true },
          create: { tipo: 'CONFIRMACION', mensaje: dto.confirmacion.trim(), activo: true },
        });
      }

      if (dto.recordatorio !== undefined && dto.recordatorio.trim() !== '') {
        await this.prisma.whatsAppPlantilla.upsert({
          where: { tipo: 'RECORDATORIO' },
          update: { mensaje: dto.recordatorio.trim(), activo: true },
          create: { tipo: 'RECORDATORIO', mensaje: dto.recordatorio.trim(), activo: true },
        });
      }
    }

    return this.obtenerPlantillas();
  }

  /**
   * Restablece las plantillas a los textos oficiales por defecto.
   */
  async resetPlantillas(): Promise<{ confirmacion: string; recordatorio: string }> {
    if (this.prisma) {
      await this.prisma.whatsAppPlantilla.deleteMany({
        where: { tipo: { in: ['CONFIRMACION', 'RECORDATORIO'] } },
      });
    }

    return {
      confirmacion: PLANTILLA_CONFIRMACION_DEFAULT,
      recordatorio: PLANTILLA_RECORDATORIO_DEFAULT,
    };
  }

  /**
   * Envía la confirmación inmediata de reserva al cliente usando la plantilla configurada.
   */
  async enviarConfirmacionReserva(datos: DatosConfirmacionWhatsApp): Promise<boolean> {
    const { confirmacion } = await this.obtenerPlantillas();
    const mensaje = this.reemplazarVariables(confirmacion, datos);
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía el recordatorio automático 2 horas antes de la cita usando la plantilla configurada.
   */
  async enviarRecordatorioReserva(datos: DatosConfirmacionWhatsApp): Promise<boolean> {
    const { recordatorio } = await this.obtenerPlantillas();
    const mensaje = this.reemplazarVariables(recordatorio, datos);
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía notificación cuando la cita es cancelada.
   */
  async enviarCancelacionReserva(datos: DatosConfirmacionWhatsApp): Promise<boolean> {
    const mensaje =
      `❌ *CITA CANCELADA - KYRIOS BARBER*\n` +
      `Hola ${datos.clienteNombre}, te confirmamos que tu cita de ${datos.servicioNombre} para el día *${datos.fecha}* a las *${datos.hora}* ha sido cancelada.\n\n` +
      `Si deseas volver a agendar, puedes hacerlo en cualquier momento desde nuestro sitio web o escribiéndonos aquí. ¡Esperamos verte pronto!`;

    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía notificación cuando la cita es reprogramada/modificada.
   */
  async enviarReprogramacionReserva(datos: DatosConfirmacionWhatsApp): Promise<boolean> {
    const mensaje =
      `🔄 *CITA REPROGRAMADA - KYRIOS BARBER*\n` +
      `¡Hola ${datos.clienteNombre}! Tu cita ha sido actualizada con éxito:\n\n` +
      `📅 *Nueva Fecha:* ${datos.fecha}\n` +
      `⏰ *Nueva Hora:* ${datos.hora}\n` +
      `✂️ *Servicio:* ${datos.servicioNombre}\n` +
      `💈 *Barbero:* ${datos.barberoNombre}\n\n` +
      `📍 *Ubicación:* Carrera 6 # 3-45, Centro Histórico, Popayán\n` +
      `_¡Te esperamos!_`;

    return this.enviarMensaje(datos.telefono, mensaje);
  }
}

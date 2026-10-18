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
  isJidBroadcast,
  isJidStatusBroadcast,
  isJidNewsletter,
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

// Filtro para silenciar logs internos ruidosos de libsignal (mensajes históricos entrantes o estados no relevantes para notificaciones salientes)
const esLogRuidosoLibsignal = (...args: any[]): boolean => {
  const text = args
    .map((a) => (typeof a === 'string' ? a : a?.message || ''))
    .join(' ');
  return (
    text.includes('Closing session:') ||
    text.includes('Closing open session') ||
    text.includes('Decrypted message with closed session') ||
    text.includes('Failed to decrypt message') ||
    text.includes('Bad MAC') ||
    text.includes('Session error')
  );
};

const originalConsoleInfo = console.info;
console.info = (...args: any[]) => {
  if (esLogRuidosoLibsignal(...args)) return;
  originalConsoleInfo(...args);
};

const originalConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
  if (esLogRuidosoLibsignal(...args)) return;
  originalConsoleWarn(...args);
};

const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  if (esLogRuidosoLibsignal(...args)) return;
  originalConsoleError(...args);
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

export const MINUTOS_ANTICIPACION_DEFAULT = 120;

export interface DatosConfirmacionWhatsApp {
  telefono: string;
  clienteNombre: string;
  servicioNombre: string;
  barberoNombre: string;
  fecha: string;
  hora: string;
  precio?: number | string | null;
}

/**
 * Enmascara un número telefónico o JID para proteger la privacidad en logs (Auditoría / OWASP).
 * Ejemplo: "3187594854" -> "318****854", "573187594854@s.whatsapp.net" -> "57318****854@s.whatsapp.net"
 */
export function enmascararTelefono(identificador?: string | null): string {
  if (!identificador) return '***';
  if (identificador.includes('@')) {
    const [num, domain] = identificador.split('@');
    return `${enmascararTelefono(num)}@${domain}`;
  }
  const limpio = identificador.trim();
  if (limpio.length <= 4) return '****';
  const inicio = limpio.slice(0, 3);
  const fin = limpio.slice(-3);
  return `${inicio}****${fin}`;
}

@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private sock: WASocket | null = null;
  private isConnected = false;
  private qrDataUrl: string | null = null;
  private readonly sessionDir: string;
  private isIntentionalDisconnect = false;
  private isConnecting = false;
  private qrInactivityTimer: NodeJS.Timeout | null = null;
  private enReposo = true;

  constructor(@Optional() private readonly prisma?: PrismaService) {
    this.sessionDir =
      process.env.WHATSAPP_SESSION_PATH ||
      path.join(os.homedir(), '.kyrios_whatsapp_session');
  }

  /**
   * Determina si ya existe una sesión guardada y debidamente autenticada en el disco.
   * Una sesión válida de Baileys contiene credenciales con la cuenta del usuario ('me' con un id/jid válido).
   * Un creds.json sin 'me' es solo un intento preliminar de escaneo de QR no vinculado aún.
   */
  tieneSesionGuardada(): boolean {
    try {
      const credsPath = path.join(this.sessionDir, 'creds.json');
      if (!fs.existsSync(credsPath)) return false;
      const raw = fs.readFileSync(credsPath, 'utf8');
      const creds = JSON.parse(raw);
      return Boolean(creds && creds.me && (creds.me.id || creds.me.jid));
    } catch {
      return false;
    }
  }

  private limpiarTimerInactividad() {
    if (this.qrInactivityTimer) {
      clearTimeout(this.qrInactivityTimer);
      this.qrInactivityTimer = null;
    }
  }

  private reiniciarTimerInactividad() {
    this.limpiarTimerInactividad();
    // Temporizador estricto de 60 segundos si estamos en proceso de escaneo de QR
    if (!this.isConnected && !this.tieneSesionGuardada()) {
      this.qrInactivityTimer = setTimeout(() => {
        if (!this.isConnected && !this.tieneSesionGuardada()) {
          this.logger.log(
            'Límite de 60 segundos alcanzado en el backend sin escaneo. Cerrando conexión de WhatsApp y entrando en REPOSO inmediatamente.',
          );
          this.enReposo = true;
          this.destruirSocket();
          this.qrDataUrl = null;
        }
      }, 60_000);
    }
  }

  async onModuleInit() {
    this.logger.log(
      `Servicio de WhatsApp inicializado (Directorio: ${this.sessionDir})`,
    );
    if (this.tieneSesionGuardada()) {
      this.enReposo = false;
      this.logger.log(
        'Sesión previa encontrada en disco. Conectando automáticamente con WhatsApp Web...',
      );
      await this.iniciarSocket();
    } else {
      this.enReposo = true;
      this.logger.log(
        'No hay sesión previa vinculada. WhatsApp en modo REPOSO (se generará el código QR bajo demanda cuando un administrador abra /whatsapp).',
      );
    }
  }

  async onModuleDestroy() {
    this.destruirSocket();
  }

  private destruirSocket() {
    this.limpiarTimerInactividad();
    if (this.sock) {
      const sockRef = this.sock;
      this.sock = null;
      try {
        sockRef.ev.removeAllListeners('connection.update');
        sockRef.ev.removeAllListeners('creds.update');
        (sockRef as any).ws?.close?.();
        (sockRef as any).ws?.terminate?.();
        sockRef.end(undefined);
      } catch (err) {
        this.logger.warn(`Error cerrando socket anterior: ${err}`);
      }
    }
    this.isConnecting = false;
  }

  async iniciarSocket() {
    if (this.isConnecting) return;
    if (this.sock && this.isConnected) return;
    this.isConnecting = true;

    try {
      this.destruirSocket();
      this.isConnecting = true;

      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

      if (this.enReposo) {
        this.logger.log(
          'Cancelando inicio de socket porque WhatsApp está en REPOSO.',
        );
        return;
      }

      const socket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Kyrios Barber Studio', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60_000,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        shouldIgnoreJid: (jid) =>
          isJidBroadcast(jid) ||
          isJidStatusBroadcast(jid) ||
          (typeof isJidNewsletter === 'function'
            ? isJidNewsletter(jid)
            : false) ||
          jid.includes('broadcast'),
        getMessage: async () => undefined,
        markOnlineOnConnect: false,
      });

      this.sock = socket;

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('connection.update', async (update) => {
        // GUARDA CRÍTICA: Si el servicio está en reposo o el socket fue reemplazado, descartar y cerrar inmediatamente
        if (this.enReposo || this.sock !== socket) {
          try {
            socket.ev.removeAllListeners('connection.update');
            socket.ev.removeAllListeners('creds.update');
            (socket as any).ws?.close?.();
            (socket as any).ws?.terminate?.();
            socket.end?.(undefined);
          } catch {}
          return;
        }

        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, {
              width: 320,
              margin: 2,
              color: { dark: '#0C0C0C', light: '#FFFFFF' },
            });
            this.isConnected = false;
            this.reiniciarTimerInactividad();
            this.logger.log(
              'Nuevo código QR de WhatsApp generado bajo demanda.',
            );
          } catch (err) {
            this.logger.error('Error convirtiendo QR a imagen DataURL', err);
          }
        }

        if (connection === 'open') {
          this.isConnected = true;
          this.enReposo = false;
          this.qrDataUrl = null;
          this.isIntentionalDisconnect = false;
          this.limpiarTimerInactividad();
          this.logger.log('🟢 CONEXIÓN ESTABLECIDA CON WHATSAPP WEB.');
        }

        if (connection === 'close') {
          this.isConnected = false;
          this.limpiarTimerInactividad();
          const statusCode = (lastDisconnect?.error as Boom)?.output
            ?.statusCode;
          const hasSavedSession = this.tieneSesionGuardada();

          this.logger.warn(
            `Conexión cerrada con WhatsApp. Código de salida: ${statusCode}. Tiene sesión autenticada: ${hasSavedSession}`,
          );

          if (statusCode === DisconnectReason.connectionReplaced) {
            this.logger.warn(
              'La sesión de WhatsApp fue abierta en otro lugar o navegador (440). No se reintentará automáticamente.',
            );
            this.qrDataUrl = null;
            this.destruirSocket();
            return;
          }

          if (
            statusCode === DisconnectReason.loggedOut ||
            this.isIntentionalDisconnect
          ) {
            this.logger.log(
              'Sesión cerrada o desvinculada. Limpiando credenciales locales...',
            );
            this.qrDataUrl = null;
            this.destruirSocket();
            this.limpiarCarpetaSesion();
            this.isIntentionalDisconnect = false;
            return;
          }

          // IMPORTANTE: Destruir siempre la referencia al socket cerrado para liberar el puerto
          this.destruirSocket();

          // Si ya teníamos una sesión autenticada guardada, reconectar automáticamente para seguir despachando citas
          if (hasSavedSession) {
            this.qrDataUrl = null;
            const delay =
              statusCode === DisconnectReason.restartRequired ? 1500 : 4000;
            this.logger.log(
              `Reconectando sesión guardada de WhatsApp en ${delay / 1000}s...`,
            );
            setTimeout(() => {
              if (this.tieneSesionGuardada()) {
                void this.iniciarSocket();
              }
            }, delay);
            return;
          }

          // Si NO tenía sesión autenticada (estaba esperando escaneo de QR):
          // El código 515 (restartRequired) es una solicitud normal de WhatsApp para reiniciar el stream
          if (
            !this.enReposo &&
            (statusCode === DisconnectReason.restartRequired ||
              statusCode === 515)
          ) {
            this.logger.log(
              'WhatsApp solicitó reinicio del socket (515) durante la generación de QR. Regenerando socket y QR en 1s...',
            );
            setTimeout(() => {
              if (
                !this.enReposo &&
                !this.isConnected &&
                !this.tieneSesionGuardada()
              ) {
                void this.iniciarSocket();
              }
            }, 1000);
            return;
          }

          // Si WhatsApp cerró por timeout o expiró el tiempo de escaneo:
          this.logger.log(
            'Tiempo de escaneo de QR expirado sin interacción. Entrando en REPOSO hasta nueva solicitud del frontend.',
          );
          this.enReposo = true;
          this.qrDataUrl = null;
          this.limpiarCarpetaSesionIncompleta();
        }
      });
    } catch (error) {
      this.logger.error(
        'Error fatal inicializando Baileys WhatsApp Socket:',
        error,
      );
    } finally {
      this.isConnecting = false;
    }
  }

  private limpiarCarpetaSesion() {
    try {
      if (fs.existsSync(this.sessionDir)) {
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
        this.logger.log(
          `Carpeta de sesión eliminada con éxito: ${this.sessionDir}`,
        );
      }
    } catch (err) {
      this.logger.error('Error eliminando carpeta de sesión de WhatsApp:', err);
    }
  }

  private limpiarCarpetaSesionIncompleta() {
    try {
      if (!this.tieneSesionGuardada() && fs.existsSync(this.sessionDir)) {
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
        this.logger.log(
          'Archivos de sesión preliminar no autenticada limpiados de disco.',
        );
      }
    } catch (err) {
      this.logger.warn(`Error limpiando sesión incompleta: ${err}`);
    }
  }

  getStatus(): { conectado: boolean; qr: string | null } {
    return {
      conectado: this.isConnected,
      qr: this.isConnected ? null : this.qrDataUrl,
    };
  }

  /**
   * Reactiva el socket bajo demanda para vincular WhatsApp generando un código QR nuevo.
   */
  iniciar(): { mensaje: string } {
    this.enReposo = false;
    if (this.isConnected) {
      return { mensaje: 'WhatsApp ya se encuentra conectado.' };
    }
    if (this.isConnecting) {
      return { mensaje: 'WhatsApp ya está iniciando.' };
    }
    // Si ya había un socket viejo o inactivo, lo destruimos para iniciar uno nuevo limpio
    if (this.sock) {
      this.destruirSocket();
    }
    this.logger.log('Iniciando socket de WhatsApp bajo demanda...');
    void this.iniciarSocket();
    return { mensaje: 'Iniciando WhatsApp...' };
  }

  /**
   * Pone a WhatsApp en reposo inmediato cerrando el socket activo y cancelando temporizadores.
   */
  pausar(): { mensaje: string } {
    if (!this.isConnected && !this.tieneSesionGuardada()) {
      this.enReposo = true;
      this.destruirSocket();
      this.qrDataUrl = null;
      this.limpiarCarpetaSesionIncompleta();
      this.logger.log(
        'WhatsApp puesto en modo REPOSO (socket cerrado y timer cancelado).',
      );
      return { mensaje: 'WhatsApp en modo reposo.' };
    }
    return { mensaje: 'WhatsApp activo con sesión guardada.' };
  }

  async desconectar(): Promise<{ mensaje: string }> {
    this.isIntentionalDisconnect = true;
    this.isConnected = false;
    this.qrDataUrl = null;
    this.enReposo = true;

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (err) {
        this.logger.warn(`Error enviando logout a WhatsApp: ${err}`);
      }
    }

    this.destruirSocket();
    this.limpiarCarpetaSesion();
    this.isIntentionalDisconnect = false;

    return { mensaje: 'Dispositivo WhatsApp desvinculado con éxito.' };
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
      this.logger.warn(
        `No se envió el mensaje a ${enmascararTelefono(telefono)}: WhatsApp no está conectado.`,
      );
      return false;
    }

    const jid = this.formatearNumeroAJid(telefono);
    if (!jid) {
      this.logger.warn(
        `Teléfono inválido para WhatsApp: ${enmascararTelefono(telefono)}`,
      );
      return false;
    }

    try {
      await this.sock.sendMessage(jid, { text: texto });
      this.logger.log(
        `Mensaje de WhatsApp enviado exitosamente a ${enmascararTelefono(jid)}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Error enviando mensaje por WhatsApp a ${enmascararTelefono(jid)}:`,
        error,
      );
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
   * Obtiene los minutos de anticipación configurados para enviar el recordatorio automático.
   * Por defecto: 120 minutos (2 horas antes de la cita).
   */
  async obtenerMinutosAnticipacion(): Promise<number> {
    if (!this.prisma) return MINUTOS_ANTICIPACION_DEFAULT;
    try {
      const config = await this.prisma.whatsAppPlantilla.findUnique({
        where: { tipo: 'CONFIG_RECORDATORIO_MINUTOS' },
      });
      if (config?.mensaje) {
        const parsed = parseInt(config.mensaje, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch (err) {
      this.logger.warn(`Error leyendo tiempo de anticipación de BD: ${err}`);
    }
    return MINUTOS_ANTICIPACION_DEFAULT;
  }

  /**
   * Obtiene las plantillas de mensajes configuradas en la base de datos o retorna las predeterminadas.
   */
  async obtenerPlantillas(): Promise<{
    confirmacion: string;
    recordatorio: string;
    minutosAnticipacion: number;
  }> {
    const minutosAnticipacion = await this.obtenerMinutosAnticipacion();

    if (!this.prisma) {
      return {
        confirmacion: PLANTILLA_CONFIRMACION_DEFAULT,
        recordatorio: PLANTILLA_RECORDATORIO_DEFAULT,
        minutosAnticipacion,
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

      return { confirmacion, recordatorio, minutosAnticipacion };
    } catch (err) {
      this.logger.warn(
        `Error leyendo plantillas de BD, usando valores por defecto: ${err}`,
      );
      return {
        confirmacion: PLANTILLA_CONFIRMACION_DEFAULT,
        recordatorio: PLANTILLA_RECORDATORIO_DEFAULT,
        minutosAnticipacion,
      };
    }
  }

  /**
   * Actualiza o crea las plantillas de mensajes y configuración en la base de datos.
   */
  async guardarPlantillas(dto: ActualizarPlantillasDto): Promise<{
    confirmacion: string;
    recordatorio: string;
    minutosAnticipacion: number;
  }> {
    if (this.prisma) {
      if (dto.confirmacion !== undefined && dto.confirmacion.trim() !== '') {
        await this.prisma.whatsAppPlantilla.upsert({
          where: { tipo: 'CONFIRMACION' },
          update: { mensaje: dto.confirmacion.trim(), activo: true },
          create: {
            tipo: 'CONFIRMACION',
            mensaje: dto.confirmacion.trim(),
            activo: true,
          },
        });
      }

      if (dto.recordatorio !== undefined && dto.recordatorio.trim() !== '') {
        await this.prisma.whatsAppPlantilla.upsert({
          where: { tipo: 'RECORDATORIO' },
          update: { mensaje: dto.recordatorio.trim(), activo: true },
          create: {
            tipo: 'RECORDATORIO',
            mensaje: dto.recordatorio.trim(),
            activo: true,
          },
        });
      }

      if (
        dto.minutosAnticipacion !== undefined &&
        dto.minutosAnticipacion > 0
      ) {
        await this.prisma.whatsAppPlantilla.upsert({
          where: { tipo: 'CONFIG_RECORDATORIO_MINUTOS' },
          update: { mensaje: String(dto.minutosAnticipacion), activo: true },
          create: {
            tipo: 'CONFIG_RECORDATORIO_MINUTOS',
            mensaje: String(dto.minutosAnticipacion),
            activo: true,
          },
        });
      }
    }

    return this.obtenerPlantillas();
  }

  /**
   * Restablece las plantillas a los textos oficiales por defecto.
   */
  async resetPlantillas(): Promise<{
    confirmacion: string;
    recordatorio: string;
    minutosAnticipacion: number;
  }> {
    if (this.prisma) {
      await this.prisma.whatsAppPlantilla.deleteMany({
        where: {
          tipo: {
            in: ['CONFIRMACION', 'RECORDATORIO', 'CONFIG_RECORDATORIO_MINUTOS'],
          },
        },
      });
    }

    return {
      confirmacion: PLANTILLA_CONFIRMACION_DEFAULT,
      recordatorio: PLANTILLA_RECORDATORIO_DEFAULT,
      minutosAnticipacion: MINUTOS_ANTICIPACION_DEFAULT,
    };
  }

  /**
   * Envía la confirmación inmediata de reserva al cliente usando la plantilla configurada.
   */
  async enviarConfirmacionReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const { confirmacion } = await this.obtenerPlantillas();
    const mensaje = this.reemplazarVariables(confirmacion, datos);
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía el recordatorio automático 2 horas antes de la cita usando la plantilla configurada.
   */
  async enviarRecordatorioReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const { recordatorio } = await this.obtenerPlantillas();
    const mensaje = this.reemplazarVariables(recordatorio, datos);
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía notificación cuando la cita es cancelada.
   */
  async enviarCancelacionReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const mensaje =
      `❌ *CITA CANCELADA - KYRIOS BARBER*\n` +
      `Hola ${datos.clienteNombre}, te confirmamos que tu cita de ${datos.servicioNombre} para el día *${datos.fecha}* a las *${datos.hora}* ha sido cancelada.\n\n` +
      `Si deseas volver a agendar, puedes hacerlo en cualquier momento desde nuestro sitio web o escribiéndonos aquí. ¡Esperamos verte pronto!`;

    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía notificación cuando la cita es marcada como completada.
   */
  async enviarCompletadoReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const mensaje =
      `✅ *CITA COMPLETADA - KYRIOS BARBER*\n` +
      `¡Hola ${datos.clienteNombre}! Tu cita de ${datos.servicioNombre} del día *${datos.fecha}* a las *${datos.hora}* ha sido marcada como completada.\n\n` +
      `¡Gracias por tu visita! Esperamos verte de nuevo pronto en Kyrios Barber Studio.`;

    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía notificación cuando la cita es reprogramada/modificada.
   */
  async enviarReprogramacionReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
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

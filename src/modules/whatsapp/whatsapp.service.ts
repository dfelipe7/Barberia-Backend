import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
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
import {
  PlantillaWhatsApp,
  WhatsAppPlantillasRepository,
} from './whatsapp-plantillas.repository';
import { ConfiguracionService } from '../configuracion/service/configuracion.service';
import { CLAVES_CONFIGURACION } from '../configuracion/configuracion.constants';
import { NegocioContextoService } from '../negocios/negocio-contexto.service';
import { NegociosRepository } from '../negocios/repository/negocios.repository';
import { PerfilNegocioService } from '../perfil-negocio/service/perfil-negocio.service';

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
  `💈 *{negocio}*\n` +
  `¡Hola {cliente}! Tu cita ha sido agendada con éxito.\n\n` +
  `📅 *Fecha:* {fecha}\n` +
  `⏰ *Hora:* {hora}\n` +
  `✂️ *Servicio:* {servicio}\n` +
  `💈 *Barbero:* {barbero}` +
  `{precio}` +
  `\n\n📍 *Ubicación:* {ubicacion}\n` +
  `_Te esperamos 5 minutos antes de tu cita. ¡Gracias por elegirnos!_`;

export const PLANTILLA_RECORDATORIO_DEFAULT =
  `⏰ *RECORDATORIO DE TU CITA - {negocio}*\n` +
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
  negocioId?: number;
  enlaceGestion?: string | null;
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

export interface SesionWhatsAppNegocio {
  negocioId: number;
  sock: WASocket | null;
  isConnected: boolean;
  qrDataUrl: string | null;
  sessionDir: string;
  isIntentionalDisconnect: boolean;
  isConnecting: boolean;
  qrInactivityTimer: NodeJS.Timeout | null;
  enReposo: boolean;
}

@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly sesiones = new Map<number, SesionWhatsAppNegocio>();
  private readonly baseSessionDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly plantillasRepository: WhatsAppPlantillasRepository,
    private readonly configuracionService: ConfiguracionService,
    private readonly contextoService: NegocioContextoService,
    private readonly negociosRepository: NegociosRepository,
    private readonly perfilNegocioService: PerfilNegocioService,
  ) {
    this.baseSessionDir =
      process.env.WHATSAPP_SESSION_PATH ||
      path.join(os.homedir(), '.barberia_whatsapp_sessions');
  }

  /**
   * Resuelve el negocioId objetivo:
   * 1. Parámetro explícito negocioIdParam (si > 0).
   * 2. Negocio del contexto de la petición actual (AsyncLocalStorage).
   * 3. Fallback a 1 (Kyrios Studio / tenant principal).
   */
  resolverNegocioId(negocioIdParam?: number | null): number {
    if (negocioIdParam && negocioIdParam > 0) {
      return negocioIdParam;
    }
    const contexto = this.contextoService.obtenerContexto();
    if (contexto?.id) {
      return contexto.id;
    }
    return 1;
  }

  /**
   * Obtiene la ruta en disco de la sesión de un negocio específico.
   * Para negocio 1, si existe la carpeta histórica ~/.kyrios_whatsapp_session,
   * se migra automáticamente a ~/.barberia_whatsapp_sessions/negocio_1
   * para conservar la sesión activa sin necesidad de volver a escanear el QR.
   */
  obtenerDirectorioSesion(negocioId: number): string {
    const dirNegocio = path.join(this.baseSessionDir, `negocio_${negocioId}`);

    // Migración transparente de sesión histórica para Kyrios Studio (Negocio 1)
    if (negocioId === 1 && !fs.existsSync(dirNegocio)) {
      const dirHistorico = path.join(os.homedir(), '.kyrios_whatsapp_session');
      if (fs.existsSync(dirHistorico)) {
        try {
          fs.mkdirSync(this.baseSessionDir, { recursive: true });
          fs.cpSync(dirHistorico, dirNegocio, { recursive: true });
          this.logger.log(
            `Migrada sesión histórica de WhatsApp para Kyrios (negocio 1) a ${dirNegocio}`,
          );
        } catch (e) {
          this.logger.warn(
            `No se pudo migrar la sesión histórica de WhatsApp: ${e}`,
          );
          return dirHistorico;
        }
      }
    }

    return dirNegocio;
  }

  /**
   * Obtiene o instancia el estado en memoria de la sesión del negocio.
   */
  private obtenerOCrearSesion(negocioId: number): SesionWhatsAppNegocio {
    let sesion = this.sesiones.get(negocioId);
    if (!sesion) {
      const sessionDir = this.obtenerDirectorioSesion(negocioId);
      sesion = {
        negocioId,
        sock: null,
        isConnected: false,
        qrDataUrl: null,
        sessionDir,
        isIntentionalDisconnect: false,
        isConnecting: false,
        qrInactivityTimer: null,
        enReposo: true,
      };
      this.sesiones.set(negocioId, sesion);
    }
    return sesion;
  }

  /**
   * Determina si ya existe una sesión guardada y debidamente autenticada en el disco
   * para el negocio indicado (o el negocio del contexto).
   * Una sesión válida de Baileys contiene credenciales con la cuenta del usuario ('me' con un id/jid válido).
   * Un creds.json sin 'me' es solo un intento preliminar de escaneo de QR no vinculado aún.
   */
  tieneSesionGuardada(negocioIdParam?: number): boolean {
    try {
      const negocioId = this.resolverNegocioId(negocioIdParam);
      const sesion = this.obtenerOCrearSesion(negocioId);
      const credsPath = path.join(sesion.sessionDir, 'creds.json');
      if (!fs.existsSync(credsPath)) return false;
      const raw = fs.readFileSync(credsPath, 'utf8');
      const creds = JSON.parse(raw);
      return Boolean(creds && creds.me && (creds.me.id || creds.me.jid));
    } catch {
      return false;
    }
  }

  private limpiarTimerInactividad(sesion: SesionWhatsAppNegocio) {
    if (sesion.qrInactivityTimer) {
      clearTimeout(sesion.qrInactivityTimer);
      sesion.qrInactivityTimer = null;
    }
  }

  private reiniciarTimerInactividad(sesion: SesionWhatsAppNegocio) {
    this.limpiarTimerInactividad(sesion);
    // Temporizador estricto de 60 segundos si estamos en proceso de escaneo de QR
    if (!sesion.isConnected && !this.tieneSesionGuardada(sesion.negocioId)) {
      sesion.qrInactivityTimer = setTimeout(() => {
        if (
          !sesion.isConnected &&
          !this.tieneSesionGuardada(sesion.negocioId)
        ) {
          this.logger.log(
            `[Negocio ${sesion.negocioId}] Límite de 60 segundos alcanzado en el backend sin escaneo. Cerrando conexión de WhatsApp y entrando en REPOSO inmediatamente.`,
          );
          sesion.enReposo = true;
          this.destruirSocket(sesion);
          sesion.qrDataUrl = null;
        }
      }, 60_000);
    }
  }

  async onModuleInit() {
    this.logger.log(
      `Servicio de WhatsApp Multi-Tenant inicializado (Directorio base: ${this.baseSessionDir})`,
    );

    try {
      const negocios = await this.negociosRepository.listar();
      for (const negocio of negocios) {
        if (this.tieneSesionGuardada(negocio.id)) {
          const sesion = this.obtenerOCrearSesion(negocio.id);
          sesion.enReposo = false;
          this.logger.log(
            `[Negocio ${negocio.id} - ${negocio.nombre}] Sesión previa encontrada en disco. Conectando automáticamente con WhatsApp Web...`,
          );
          await this.iniciarSocket(negocio.id);
        } else {
          this.logger.log(
            `[Negocio ${negocio.id} - ${negocio.nombre}] Sin sesión vinculada. En modo REPOSO (se generará el código QR bajo demanda).`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `No se pudieron listar los negocios para restaurar sesiones de WhatsApp: ${error}`,
      );
      if (this.tieneSesionGuardada(1)) {
        const sesion1 = this.obtenerOCrearSesion(1);
        sesion1.enReposo = false;
        await this.iniciarSocket(1);
      }
    }
  }

  onModuleDestroy() {
    for (const [, sesion] of this.sesiones) {
      this.destruirSocket(sesion);
    }
  }

  private destruirSocket(sesion: SesionWhatsAppNegocio) {
    this.limpiarTimerInactividad(sesion);
    if (sesion.sock) {
      const sockRef = sesion.sock;
      sesion.sock = null;
      try {
        sockRef.ev.removeAllListeners('connection.update');
        sockRef.ev.removeAllListeners('creds.update');
        (sockRef as any).ws?.close?.();
        (sockRef as any).ws?.terminate?.();
        void sockRef.end(undefined);
      } catch (err) {
        this.logger.warn(
          `[Negocio ${sesion.negocioId}] Error cerrando socket anterior: ${err}`,
        );
      }
    }
    sesion.isConnecting = false;
  }

  /**
   * Inicializa el socket de Baileys para la sesión del negocio especificado.
   *
   * @remarks
   * Ciclo de Vida y Resiliencia Multitenant:
   * Cada sede mantiene sus credenciales criptográficas (`useMultiFileAuthState`) en una carpeta
   * segregada. Si no existe sesión previa, emite un código QR efímero en Base64 con un timer
   * de inactividad para liberar recursos ociosos. Si se pierde la red, reconecta automáticamente.
   *
   * @param negocioIdParam - ID de la sede a conectar (opcional, fallback al contexto).
   * @returns Promesa resuelta tras iniciar la conexión o publicar el código QR.
   */
  async iniciarSocket(negocioIdParam?: number): Promise<void> {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    const sesion = this.obtenerOCrearSesion(negocioId);

    if (sesion.isConnecting) return;
    if (sesion.sock && sesion.isConnected) return;
    sesion.isConnecting = true;

    try {
      this.destruirSocket(sesion);
      sesion.isConnecting = true;

      if (!fs.existsSync(sesion.sessionDir)) {
        fs.mkdirSync(sesion.sessionDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(
        sesion.sessionDir,
      );

      if (sesion.enReposo) {
        this.logger.log(
          `[Negocio ${sesion.negocioId}] Cancelando inicio de socket porque WhatsApp está en REPOSO.`,
        );
        return;
      }

      let nombreNegocio = `Barbería Negocio ${negocioId}`;
      try {
        const negocio = await this.negociosRepository.buscarPorId(negocioId);
        if (negocio?.nombre) nombreNegocio = negocio.nombre;
      } catch {}

      const socket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: [nombreNegocio, 'Chrome', '1.0.0'],
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
        getMessage: () => Promise.resolve(undefined),
        markOnlineOnConnect: false,
      });

      sesion.sock = socket;

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('connection.update', async (update) => {
        // GUARDA CRÍTICA: Si el servicio está en reposo o el socket fue reemplazado, descartar y cerrar inmediatamente
        if (sesion.enReposo || sesion.sock !== socket) {
          try {
            socket.ev.removeAllListeners('connection.update');
            socket.ev.removeAllListeners('creds.update');
            (socket as any).ws?.close?.();
            (socket as any).ws?.terminate?.();
            void socket.end?.(undefined);
          } catch {}
          return;
        }

        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            sesion.qrDataUrl = await QRCode.toDataURL(qr, {
              width: 320,
              margin: 2,
              color: { dark: '#0C0C0C', light: '#FFFFFF' },
            });
            sesion.isConnected = false;
            this.reiniciarTimerInactividad(sesion);
            this.logger.log(
              `[Negocio ${sesion.negocioId}] Nuevo código QR de WhatsApp generado bajo demanda.`,
            );
          } catch (err) {
            this.logger.error(
              `[Negocio ${sesion.negocioId}] Error convirtiendo QR a imagen DataURL`,
              err,
            );
          }
        }

        if (connection === 'open') {
          sesion.isConnected = true;
          sesion.enReposo = false;
          sesion.qrDataUrl = null;
          sesion.isIntentionalDisconnect = false;
          this.limpiarTimerInactividad(sesion);
          this.logger.log(
            `🟢 [Negocio ${sesion.negocioId}] CONEXIÓN ESTABLECIDA CON WHATSAPP WEB.`,
          );
        }

        if (connection === 'close') {
          sesion.isConnected = false;
          this.limpiarTimerInactividad(sesion);
          const statusCode = (lastDisconnect?.error as Boom)?.output
            ?.statusCode;
          const hasSavedSession = this.tieneSesionGuardada(sesion.negocioId);

          this.logger.warn(
            `[Negocio ${sesion.negocioId}] Conexión cerrada con WhatsApp. Código de salida: ${statusCode}. Tiene sesión autenticada: ${hasSavedSession}`,
          );

          if (statusCode === DisconnectReason.connectionReplaced) {
            this.logger.warn(
              `[Negocio ${sesion.negocioId}] La sesión de WhatsApp fue abierta en otro lugar o navegador (440). No se reintentará automáticamente.`,
            );
            sesion.qrDataUrl = null;
            this.destruirSocket(sesion);
            return;
          }

          if (
            statusCode === DisconnectReason.loggedOut ||
            sesion.isIntentionalDisconnect
          ) {
            this.logger.log(
              `[Negocio ${sesion.negocioId}] Sesión cerrada o desvinculada. Limpiando credenciales locales...`,
            );
            sesion.qrDataUrl = null;
            this.destruirSocket(sesion);
            this.limpiarCarpetaSesion(sesion);
            sesion.isIntentionalDisconnect = false;
            return;
          }

          // IMPORTANTE: Destruir siempre la referencia al socket cerrado para liberar el puerto
          this.destruirSocket(sesion);

          // Si ya teníamos una sesión autenticada guardada, reconectar automáticamente para seguir despachando citas
          if (hasSavedSession) {
            sesion.qrDataUrl = null;
            const delay =
              statusCode === DisconnectReason.restartRequired ? 1500 : 4000;
            this.logger.log(
              `[Negocio ${sesion.negocioId}] Reconectando sesión guardada de WhatsApp en ${delay / 1000}s...`,
            );
            setTimeout(() => {
              if (this.tieneSesionGuardada(sesion.negocioId)) {
                void this.iniciarSocket(sesion.negocioId);
              }
            }, delay);
            return;
          }

          // Si WhatsApp solicitó reinicio del socket (515) durante la generación de QR
          if (
            !sesion.enReposo &&
            (statusCode === DisconnectReason.restartRequired ||
              statusCode === 515)
          ) {
            this.logger.log(
              `[Negocio ${sesion.negocioId}] WhatsApp solicitó reinicio del socket (515) durante la generación de QR. Regenerando socket y QR en 1s...`,
            );
            setTimeout(() => {
              if (
                !sesion.enReposo &&
                !sesion.isConnected &&
                !this.tieneSesionGuardada(sesion.negocioId)
              ) {
                void this.iniciarSocket(sesion.negocioId);
              }
            }, 1000);
            return;
          }

          // Si WhatsApp cerró por timeout o expiró el tiempo de escaneo:
          this.logger.log(
            `[Negocio ${sesion.negocioId}] Tiempo de escaneo de QR expirado sin interacción. Entrando en REPOSO hasta nueva solicitud del frontend.`,
          );
          sesion.enReposo = true;
          sesion.qrDataUrl = null;
          this.limpiarCarpetaSesionIncompleta(sesion);
        }
      });
    } catch (error) {
      this.logger.error(
        `[Negocio ${sesion.negocioId}] Error fatal inicializando Baileys WhatsApp Socket:`,
        error,
      );
    } finally {
      sesion.isConnecting = false;
    }
  }

  private limpiarCarpetaSesion(sesion: SesionWhatsAppNegocio) {
    try {
      if (fs.existsSync(sesion.sessionDir)) {
        fs.rmSync(sesion.sessionDir, { recursive: true, force: true });
        this.logger.log(
          `[Negocio ${sesion.negocioId}] Carpeta de sesión eliminada con éxito: ${sesion.sessionDir}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[Negocio ${sesion.negocioId}] Error eliminando carpeta de sesión de WhatsApp:`,
        err,
      );
    }
  }

  private limpiarCarpetaSesionIncompleta(sesion: SesionWhatsAppNegocio) {
    try {
      if (
        !this.tieneSesionGuardada(sesion.negocioId) &&
        fs.existsSync(sesion.sessionDir)
      ) {
        fs.rmSync(sesion.sessionDir, { recursive: true, force: true });
        this.logger.log(
          `[Negocio ${sesion.negocioId}] Archivos de sesión preliminar no autenticada limpiados de disco.`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[Negocio ${sesion.negocioId}] Error limpiando sesión incompleta: ${err}`,
      );
    }
  }

  getStatus(negocioIdParam?: number): {
    conectado: boolean;
    qr: string | null;
  } {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    const sesion = this.obtenerOCrearSesion(negocioId);
    return {
      conectado: sesion.isConnected,
      qr: sesion.isConnected ? null : sesion.qrDataUrl,
    };
  }

  /**
   * Comprueba si hay al menos una sesión de WhatsApp conectada en cualquier sede.
   */
  hayAlgunaSesionConectada(): boolean {
    for (const sesion of this.sesiones.values()) {
      if (sesion.isConnected) return true;
    }
    return false;
  }

  /**
   * Reactiva el socket bajo demanda para vincular WhatsApp generando un código QR nuevo.
   */
  iniciar(negocioIdParam?: number): { mensaje: string } {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    const sesion = this.obtenerOCrearSesion(negocioId);

    sesion.enReposo = false;
    if (sesion.isConnected) {
      return { mensaje: 'WhatsApp ya se encuentra conectado.' };
    }
    if (sesion.isConnecting) {
      return { mensaje: 'WhatsApp ya está iniciando.' };
    }
    // Si ya había un socket viejo o inactivo, lo destruimos para iniciar uno nuevo limpio
    if (sesion.sock) {
      this.destruirSocket(sesion);
    }
    this.logger.log(
      `[Negocio ${negocioId}] Iniciando socket de WhatsApp bajo demanda...`,
    );
    void this.iniciarSocket(negocioId);
    return { mensaje: 'Iniciando WhatsApp...' };
  }

  /**
   * Pone a WhatsApp en reposo inmediato cerrando el socket activo y cancelando temporizadores.
   */
  pausar(negocioIdParam?: number): { mensaje: string } {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    const sesion = this.obtenerOCrearSesion(negocioId);

    if (!sesion.isConnected && !this.tieneSesionGuardada(negocioId)) {
      sesion.enReposo = true;
      this.destruirSocket(sesion);
      sesion.qrDataUrl = null;
      this.limpiarCarpetaSesionIncompleta(sesion);
      this.logger.log(
        `[Negocio ${negocioId}] WhatsApp puesto en modo REPOSO (socket cerrado y timer cancelado).`,
      );
      return { mensaje: 'WhatsApp en modo reposo.' };
    }
    return { mensaje: 'WhatsApp activo con sesión guardada.' };
  }

  /**
   * Cierra la sesión activa de WhatsApp de forma controlada y desvincula el dispositivo.
   *
   * @remarks
   * Privacidad y Seguridad Criptográfica:
   * Emite un `sock.logout()` hacia WhatsApp y elimina completamente los archivos de autenticación
   * en disco (`creds.json`), previniendo claves huérfanas en el almacenamiento del backend.
   *
   * @param negocioIdParam - ID de la sede a desconectar (opcional, fallback al contexto).
   * @returns Objeto con mensaje de confirmación de desvinculación.
   */
  async desconectar(negocioIdParam?: number): Promise<{ mensaje: string }> {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    const sesion = this.obtenerOCrearSesion(negocioId);

    sesion.isIntentionalDisconnect = true;
    sesion.isConnected = false;
    sesion.qrDataUrl = null;
    sesion.enReposo = true;

    if (sesion.sock) {
      try {
        await sesion.sock.logout();
      } catch (err) {
        this.logger.warn(
          `[Negocio ${negocioId}] Error enviando logout a WhatsApp: ${err}`,
        );
      }
    }

    this.destruirSocket(sesion);
    this.limpiarCarpetaSesion(sesion);
    sesion.isIntentionalDisconnect = false;

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

  async enviarMensaje(
    telefono: string,
    texto: string,
    negocioIdParam?: number,
  ): Promise<boolean> {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    const sesion = this.obtenerOCrearSesion(negocioId);

    if (!sesion.isConnected || !sesion.sock) {
      this.logger.warn(
        `[Negocio ${negocioId}] No se envió el mensaje a ${enmascararTelefono(telefono)}: WhatsApp no está conectado.`,
      );
      return false;
    }

    const jid = this.formatearNumeroAJid(telefono);
    if (!jid) {
      this.logger.warn(
        `[Negocio ${negocioId}] Teléfono inválido para WhatsApp: ${enmascararTelefono(telefono)}`,
      );
      return false;
    }

    try {
      await sesion.sock.sendMessage(jid, { text: texto });
      this.logger.log(
        `[Negocio ${negocioId}] Mensaje de WhatsApp enviado exitosamente a ${enmascararTelefono(jid)}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[Negocio ${negocioId}] Error enviando mensaje por WhatsApp a ${enmascararTelefono(jid)}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Sustituye las variables dinámicas de una plantilla con los datos reales de
   * la reserva.
   *
   * `{negocio}` y `{ubicacion}` son datos COMERCIALES de la barbería: se
   * resuelven con la información del negocio CONTEXTO (nunca con la de otro).
   */
  reemplazarVariables(
    plantilla: string,
    datos: DatosConfirmacionWhatsApp,
    comercial?: { nombre: string; direccion: string },
  ): string {
    const precioTexto = datos.precio
      ? `\n💰 *Valor:* $${Number(datos.precio).toLocaleString('es-CO')}`
      : '';

    const nombreNegocio = comercial?.nombre?.trim() ?? '';
    const direccion = comercial?.direccion?.trim() ?? '';

    const conComerciales = plantilla
      .replaceAll('{negocio}', nombreNegocio)
      .replace(
        /📍 \*Ubicación:\* \{ubicacion\}\n?/g,
        direccion ? `📍 *Ubicación:* ${direccion}\n` : '',
      );

    const textoBase = conComerciales
      .replaceAll('{cliente}', datos.clienteNombre)
      .replaceAll('{servicio}', datos.servicioNombre)
      .replaceAll('{barbero}', datos.barberoNombre)
      .replaceAll('{fecha}', datos.fecha)
      .replaceAll('{hora}', datos.hora)
      .replaceAll('{precio}', precioTexto)
      .replaceAll('{ubicacion}', direccion);

    if (datos.enlaceGestion) {
      return (
        `${textoBase}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📲 *¿Deseas cambiar o cancelar tu cita?*\n` +
        `Puedes gestionarla en este enlace:\n` +
        `${datos.enlaceGestion}\n` +
        `━━━━━━━━━━━━━━━━━━━━`
      );
    }

    return textoBase;
  }

  /**
   * Datos COMERCIALES del negocio del contexto actual.
   *
   * FUENTES DE VERDAD
   * -----------------
   * - NOMBRE: `Negocio.nombre` del negocio del CONTEXTO. No hay un nombre
   *   por defecto: un mensaje sin contexto no inventa la identidad de una
   *   barbería.
   * - DIRECCIÓN: `PerfilNegocio.direccion` del negocio del CONTEXTO. Es la
   *   fuente canónica.
   *
   * COMPATIBILIDAD TEMPORAL
   * -----------------------
   * Mientras existan valores históricos en la clave de configuración
   * `negocio_direccion`, se usan como RESPALDO cuando el perfil no tiene
   * dirección. Es un puente explícito y acotado:
   *
   * - Solo se lee del negocio del contexto (nunca de otro).
   * - Se avisa por log cuando se usa, para que se migren los valores.
   * - Se retira cuando se hayan revisado los valores existentes: basta con
   *   copiar la dirección al perfil y eliminar la clave
   *   `negocio_direccion` de `CLAVES_CONFIGURACION_OPERATIVA`.
   *
   * Si el negocio no tiene dirección en ninguna de las dos fuentes, la
   * dirección queda VACÍA: no se inventa ni se recurre a datos de otra
   * barbería (el mensaje sale sin la línea de ubicación).
   */
  private async datosComercialesDelNegocio(): Promise<{
    nombre: string;
    direccion: string;
  }> {
    const contexto = this.contextoService.obtenerContexto();

    if (!contexto) {
      return { nombre: '', direccion: '' };
    }

    const negocio = await this.negociosRepository.buscarPorId(contexto.id);
    const nombre = negocio?.nombre?.trim() ?? '';

    let direccion = await this.leerDireccionDelPerfil(contexto);

    if (!direccion) {
      direccion = await this.leerDireccionHistorica(contexto);
    }

    return { nombre, direccion };
  }

  /** Dirección canónica: la del PERFIL del negocio del contexto. */
  private async leerDireccionDelPerfil(contexto: {
    id: number;
    slug: string;
  }): Promise<string> {
    try {
      return await this.perfilNegocioService.obtenerDireccionComercial();
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la dirección del perfil del negocio ${contexto.slug}: ${(error as Error)?.message}`,
      );

      return '';
    }
  }

  /**
   * Respaldo TEMPORAL: la clave histórica `negocio_direccion`.
   *
   * La lectura es EXCLUSIVAMENTE del ámbito del NEGOCIO del contexto
   * (`obtenerTextoDelNegocio`): nunca consulta el ámbito global de
   * plataforma, de modo que un mensaje nunca puede llevar la dirección de
   * otra barbería.
   */
  private async leerDireccionHistorica(contexto: {
    id: number;
    slug: string;
  }): Promise<string> {
    try {
      const direccion = await this.configuracionService.obtenerTextoDelNegocio(
        CLAVES_CONFIGURACION.NEGOCIO_DIRECCION,
        '',
      );

      if (direccion) {
        this.logger.warn(
          `El negocio ${contexto.slug} usa la dirección histórica de la clave ` +
            `'${CLAVES_CONFIGURACION.NEGOCIO_DIRECCION}' porque su perfil no tiene ` +
            'dirección. Migre el valor al perfil y retire esa clave.',
        );
      }

      return direccion ?? '';
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la dirección del negocio ${contexto.slug}: ${(error as Error)?.message}`,
      );

      return '';
    }
  }

  /**
   * Identificador del negocio del contexto actual, o `null` si la operación es
   * de plataforma (gestión de las plantillas globales).
   */
  private negocioIdDelContexto(): number | null {
    return this.contextoService.obtenerContexto()?.id ?? null;
  }

  /**
   * Obtiene los minutos de anticipación configurados para enviar el recordatorio
   * automático.
   *
   * ORDEN DE RESOLUCIÓN (HU-11): la configuración del NEGOCIO tiene prioridad;
   * si no existe, se usa la plantilla GLOBAL de plataforma; si tampoco existe,
   * el valor por defecto (120 minutos).
   */
  async obtenerMinutosAnticipacion(): Promise<number> {
    const negocioId = this.negocioIdDelContexto();

    if (negocioId !== null) {
      try {
        const valor = await this.configuracionService.obtenerNumero(
          CLAVES_CONFIGURACION.RECORDATORIO_MINUTOS_ANTICIPACION,
          0,
          { minimo: 1, maximo: 10080, entero: true },
        );

        if (valor > 0) {
          return valor;
        }
      } catch (error) {
        this.logger.warn(
          `No se pudo leer la anticipación del negocio ${negocioId}: ${(error as Error)?.message}`,
        );
      }
    }

    const plantilla = await this.obtenerPlantillaGlobal(
      'CONFIG_RECORDATORIO_MINUTOS',
    );

    if (plantilla?.mensaje) {
      const parsed = Number.parseInt(plantilla.mensaje, 10);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }

    return MINUTOS_ANTICIPACION_DEFAULT;
  }

  /**
   * Obtiene la plantilla GLOBAL de plataforma de un tipo (`negocioId = NULL`).
   */
  private async obtenerPlantillaGlobal(
    tipo: string,
  ): Promise<PlantillaWhatsApp | null> {
    try {
      const plantillas =
        await this.plantillasRepository.obtenerPlantillas(null);
      return plantillas.find((p) => p.tipo === tipo) ?? null;
    } catch (err) {
      this.logger.warn(`Error leyendo la plantilla global '${tipo}': ${err}`);
      return null;
    }
  }

  /**
   * Obtiene las plantillas de mensajes configuradas en la base de datos o
   * retorna las predeterminadas.
   *
   * REGLA DE RESOLUCIÓN (HU-11): la plantilla del NEGOCIO tiene prioridad
   * sobre la GLOBAL de plataforma, que a su vez tiene prioridad sobre el texto
   * por defecto del código.
   */
  async obtenerPlantillas(): Promise<{
    confirmacion: string;
    recordatorio: string;
    minutosAnticipacion: number;
  }> {
    const minutosAnticipacion = await this.obtenerMinutosAnticipacion();
    const negocioId = this.negocioIdDelContexto();

    let plantillas: PlantillaWhatsApp[] = [];

    try {
      plantillas = await this.plantillasRepository.obtenerPlantillas(negocioId);
    } catch (err) {
      this.logger.warn(
        `Error leyendo plantillas de BD, usando valores por defecto: ${err}`,
      );
    }

    const elegir = (tipo: string, porDefecto: string): string => {
      const propia = plantillas.find(
        (p) => p.tipo === tipo && p.negocioId === negocioId,
      );
      if (propia?.mensaje) {
        return propia.mensaje;
      }

      const global = plantillas.find(
        (p) => p.tipo === tipo && p.negocioId === null,
      );

      return global?.mensaje || porDefecto;
    };

    return {
      confirmacion: elegir('CONFIRMACION', PLANTILLA_CONFIRMACION_DEFAULT),
      recordatorio: elegir('RECORDATORIO', PLANTILLA_RECORDATORIO_DEFAULT),
      minutosAnticipacion,
    };
  }

  /**
   * Actualiza o crea las plantillas de mensajes y configuración en la base de datos.
   *
   * @remarks
   * Política Multitenant (HU-11):
   * Las plantillas se persisten asociadas al ID del negocio activo del contexto.
   * Si no existe contexto de negocio (operación global de plataforma), se guardan
   * con `negocioId = null` como valores predeterminados globales de respaldo.
   *
   * @param dto - Textos de plantillas y minutos de anticipación configurados.
   * @returns Plantillas efectivas consolidadas tras la actualización.
   */
  async guardarPlantillas(dto: ActualizarPlantillasDto): Promise<{
    confirmacion: string;
    recordatorio: string;
    minutosAnticipacion: number;
  }> {
    const negocioId = this.negocioIdDelContexto();

    if (dto.confirmacion !== undefined && dto.confirmacion.trim() !== '') {
      await this.plantillasRepository.guardarPlantilla(
        negocioId,
        'CONFIRMACION',
        dto.confirmacion.trim(),
      );
    }

    if (dto.recordatorio !== undefined && dto.recordatorio.trim() !== '') {
      await this.plantillasRepository.guardarPlantilla(
        negocioId,
        'RECORDATORIO',
        dto.recordatorio.trim(),
      );
    }

    if (dto.minutosAnticipacion !== undefined && dto.minutosAnticipacion > 0) {
      // La anticipación es una POLÍTICA del negocio: se guarda en su
      // configuración, no en la plantilla global.
      if (negocioId !== null) {
        await this.configuracionService.guardarNumero(
          negocioId,
          CLAVES_CONFIGURACION.RECORDATORIO_MINUTOS_ANTICIPACION,
          dto.minutosAnticipacion,
        );
      } else {
        await this.plantillasRepository.guardarPlantilla(
          null,
          'CONFIG_RECORDATORIO_MINUTOS',
          String(dto.minutosAnticipacion),
        );
      }
    }

    return this.obtenerPlantillas();
  }

  /**
   * Restablece las plantillas de la sede a los textos oficiales por defecto del sistema.
   *
   * @remarks
   * Política Multitenant (HU-11):
   * Elimina las personalizaciones del negocio activo en base de datos para volver
   * a heredar las plantillas globales. La anticipación en minutos se reinicia a 120.
   *
   * @returns Plantillas efectivas restablecidas.
   */
  async resetPlantillas(): Promise<{
    confirmacion: string;
    recordatorio: string;
    minutosAnticipacion: number;
  }> {
    const negocioId = this.negocioIdDelContexto();

    if (negocioId !== null) {
      await this.plantillasRepository.eliminarPlantillas(negocioId, [
        'CONFIRMACION',
        'RECORDATORIO',
      ]);

      // La anticipación del negocio vive en su configuración: se restablece
      // también, para que el valor efectivo y la respuesta coincidan.
      await this.configuracionService.guardarNumero(
        negocioId,
        CLAVES_CONFIGURACION.RECORDATORIO_MINUTOS_ANTICIPACION,
        MINUTOS_ANTICIPACION_DEFAULT,
      );
    } else {
      await this.plantillasRepository.eliminarPlantillas(null, [
        'CONFIRMACION',
        'RECORDATORIO',
        'CONFIG_RECORDATORIO_MINUTOS',
      ]);
    }

    return this.obtenerPlantillas();
  }

  /**
   * Envía la confirmación inmediata de reserva al cliente usando la plantilla
   * configurada.
   *
   * La plantilla, la dirección y el nombre son los del NEGOCIO del contexto:
   * una reserva de A nunca produce un mensaje con los datos de B.
   */
  async enviarConfirmacionReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const { confirmacion } = await this.obtenerPlantillas();
    const comercial = await this.datosComercialesDelNegocio();
    const mensaje = this.reemplazarVariables(confirmacion, datos, comercial);
    if (datos.negocioId) {
      return this.enviarMensaje(datos.telefono, mensaje, datos.negocioId);
    }
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía el recordatorio automático previo a la cita utilizando la plantilla configurada.
   *
   * @remarks
   * Automatización y Retención:
   * Diseñado para ejecutarse desde el cron/worker de recordatorios según los minutos
   * de anticipación configurados en la sede. Enmascara el número en logs para cumplimiento OWASP.
   *
   * @param datos - Parámetros de la cita (cliente, barbero, servicio, fecha, hora, teléfono, negocioId)
   * @returns Promesa que resuelve `true` si el mensaje fue enviado con éxito, o `false` si falló
   */
  async enviarRecordatorioReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const { recordatorio } = await this.obtenerPlantillas();
    const comercial = await this.datosComercialesDelNegocio();
    const mensaje = this.reemplazarVariables(recordatorio, datos, comercial);
    if (datos.negocioId) {
      return this.enviarMensaje(datos.telefono, mensaje, datos.negocioId);
    }
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Notifica al cliente la cancelación de su cita vía WhatsApp.
   *
   * @remarks
   * Experiencia de Cliente y Reagendamiento:
   * Informa oportunamente la liberación del turno e invita al cliente a agendar
   * nuevamente preservando el canal de comunicación y la identidad de marca de la sede.
   *
   * @param datos - Datos del cliente y de la cita cancelada
   * @returns Promesa que resuelve `true` si el mensaje fue emitido exitosamente
   */
  async enviarCancelacionReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const comercial = await this.datosComercialesDelNegocio();
    const ubicacion = comercial.direccion
      ? `\n📍 *Ubicación:* ${comercial.direccion}`
      : '';

    const mensaje =
      `❌ *CITA CANCELADA - ${comercial.nombre}*\n` +
      `Hola ${datos.clienteNombre}, te confirmamos que tu cita de ${datos.servicioNombre} para el día *${datos.fecha}* a las *${datos.hora}* ha sido cancelada.\n\n` +
      `Si deseas volver a agendar, puedes hacerlo en cualquier momento desde nuestro sitio web o escribiéndonos aquí. ¡Esperamos verte pronto!` +
      ubicacion;

    if (datos.negocioId) {
      return this.enviarMensaje(datos.telefono, mensaje, datos.negocioId);
    }
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía mensaje de agradecimiento y fidelización tras marcar la cita como completada.
   *
   * @remarks
   * Fidelización Post-Servicio:
   * Refuerza la relación comercial tras la atención exitosa del barbero en la sede.
   *
   * @param datos - Datos del cliente, servicio recibido y sede
   * @returns Promesa que resuelve `true` si el mensaje fue transmitido
   */
  async enviarCompletadoReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const comercial = await this.datosComercialesDelNegocio();

    const mensaje =
      `✅ *CITA COMPLETADA - ${comercial.nombre}*\n` +
      `¡Hola ${datos.clienteNombre}! Tu cita de ${datos.servicioNombre} del día *${datos.fecha}* a las *${datos.hora}* ha sido marcada como completada.\n\n` +
      `¡Gracias por tu visita! Esperamos verte de nuevo pronto en ${comercial.nombre}.`;

    if (datos.negocioId) {
      return this.enviarMensaje(datos.telefono, mensaje, datos.negocioId);
    }
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Notifica al cliente cuando su cita ha sido modificada de fecha, hora o barbero.
   *
   * @remarks
   * Consistencia Operativa:
   * Proporciona de inmediato el nuevo itinerario para evitar confusiones o ausencias en la sede.
   *
   * @param datos - Parámetros actualizados de la cita (nueva fecha, nueva hora, profesional)
   * @returns Promesa que resuelve `true` si la notificación fue enviada
   */
  async enviarReprogramacionReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const comercial = await this.datosComercialesDelNegocio();
    const ubicacion = comercial.direccion
      ? `\n📍 *Ubicación:* ${comercial.direccion}\n`
      : '';

    const mensaje =
      `🔄 *CITA REPROGRAMADA - ${comercial.nombre}*\n` +
      `¡Hola ${datos.clienteNombre}! Tu cita ha sido actualizada con éxito:\n\n` +
      `📅 *Nueva Fecha:* ${datos.fecha}\n` +
      `⏰ *Nueva Hora:* ${datos.hora}\n` +
      `✂️ *Servicio:* ${datos.servicioNombre}\n` +
      `💈 *Barbero:* ${datos.barberoNombre}\n` +
      ubicacion +
      `_¡Te esperamos!_`;

    if (datos.negocioId) {
      return this.enviarMensaje(datos.telefono, mensaje, datos.negocioId);
    }
    return this.enviarMensaje(datos.telefono, mensaje);
  }
}

import { Logger } from '@nestjs/common';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  isJidBroadcast,
  isJidStatusBroadcast,
  isJidNewsletter,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Boom } from '@hapi/boom';
import { SesionWhatsAppNegocio } from '../types/whatsapp.types';

export interface OpcionesIniciarSocket {
  nombreNegocio?: string;
  onConnected?: (negocioId: number) => void;
}

/**
 * Gestor del ciclo de vida de sockets y sesiones de WhatsApp (Baileys) para entornos multitenant.
 */
export class WhatsAppSessionManager {
  private readonly logger = new Logger(WhatsAppSessionManager.name);

  constructor(
    private readonly sesiones: Map<number, SesionWhatsAppNegocio>,
    private readonly baseSessionDir: string,
  ) {}

  /**
   * Obtiene la ruta en disco de la sesión de un negocio específico.
   * Para negocio 1, si existe la carpeta histórica ~/.kyrios_whatsapp_session,
   * se migra automáticamente a ~/.barberia_whatsapp_sessions/negocio_1
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
  obtenerOCrearSesion(negocioId: number): SesionWhatsAppNegocio {
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
   * para el negocio indicado.
   */
  tieneSesionGuardada(negocioId: number): boolean {
    try {
      const sesion = this.obtenerOCrearSesion(negocioId);
      const credsPath = path.join(sesion.sessionDir, 'creds.json');
      if (!fs.existsSync(credsPath)) return false;
      const raw = fs.readFileSync(credsPath, 'utf8');
      const creds = JSON.parse(raw) as {
        me?: { id?: string; jid?: string };
      } | null;
      return Boolean(creds && creds.me && (creds.me.id || creds.me.jid));
    } catch {
      return false;
    }
  }

  limpiarTimerInactividad(sesion: SesionWhatsAppNegocio): void {
    if (sesion.qrInactivityTimer) {
      clearTimeout(sesion.qrInactivityTimer);
      sesion.qrInactivityTimer = null;
    }
  }

  reiniciarTimerInactividad(sesion: SesionWhatsAppNegocio): void {
    this.limpiarTimerInactividad(sesion);
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

  destruirSocket(sesion: SesionWhatsAppNegocio): void {
    this.limpiarTimerInactividad(sesion);
    if (sesion.sock) {
      const sockRef = sesion.sock;
      sesion.sock = null;
      try {
        sockRef.ev.removeAllListeners('connection.update');
        sockRef.ev.removeAllListeners('creds.update');
        const ws = (
          sockRef as unknown as {
            ws?: { close?: () => void; terminate?: () => void };
          }
        ).ws;
        ws?.close?.();
        ws?.terminate?.();
        void sockRef.end(undefined);
      } catch (err) {
        this.logger.warn(
          `[Negocio ${sesion.negocioId}] Error cerrando socket anterior: ${err}`,
        );
      }
    }
    sesion.isConnecting = false;
  }

  limpiarCarpetaSesion(sesion: SesionWhatsAppNegocio): void {
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

  limpiarCarpetaSesionIncompleta(sesion: SesionWhatsAppNegocio): void {
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

  async iniciarSocket(
    negocioId: number,
    opciones?: OpcionesIniciarSocket,
  ): Promise<void> {
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

      const nombreNegocio =
        opciones?.nombreNegocio || `Barbería Negocio ${negocioId}`;

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
      socket.ev.on('creds.update', () => {
        void saveCreds();
      });

      socket.ev.on('connection.update', (update) => {
        void (async () => {
          if (sesion.enReposo || sesion.sock !== socket) {
            try {
              socket.ev.removeAllListeners('connection.update');
              socket.ev.removeAllListeners('creds.update');
              const ws = (
                socket as unknown as {
                  ws?: { close?: () => void; terminate?: () => void };
                }
              ).ws;
              ws?.close?.();
              ws?.terminate?.();
              void socket.end?.(undefined);
            } catch {
              // Ignorar error al cerrar socket en reposo
            }
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
            if (opciones?.onConnected) {
              opciones.onConnected(sesion.negocioId);
            }
          }

          if (connection === 'close') {
            sesion.isConnected = false;
            this.limpiarTimerInactividad(sesion);
            const statusCode = Number(
              (lastDisconnect?.error as Boom)?.output?.statusCode,
            );
            const hasSavedSession = this.tieneSesionGuardada(sesion.negocioId);

            this.logger.warn(
              `[Negocio ${sesion.negocioId}] Conexión cerrada con WhatsApp. Código de salida: ${statusCode}. Tiene sesión autenticada: ${hasSavedSession}`,
            );

            if (statusCode === Number(DisconnectReason.connectionReplaced)) {
              this.logger.warn(
                `[Negocio ${sesion.negocioId}] La sesión de WhatsApp fue abierta en otro lugar o navegador (440). No se reintentará automáticamente.`,
              );
              sesion.qrDataUrl = null;
              this.destruirSocket(sesion);
              return;
            }

            if (
              statusCode === Number(DisconnectReason.loggedOut) ||
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

            this.destruirSocket(sesion);

            if (hasSavedSession) {
              sesion.qrDataUrl = null;
              const delay =
                statusCode === Number(DisconnectReason.restartRequired)
                  ? 1500
                  : 4000;
              this.logger.log(
                `[Negocio ${sesion.negocioId}] Reconectando sesión guardada de WhatsApp en ${delay / 1000}s...`,
              );
              setTimeout(() => {
                if (this.tieneSesionGuardada(sesion.negocioId)) {
                  void this.iniciarSocket(sesion.negocioId, opciones);
                }
              }, delay);
              return;
            }

            if (
              !sesion.enReposo &&
              (statusCode === Number(DisconnectReason.restartRequired) ||
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
                  void this.iniciarSocket(sesion.negocioId, opciones);
                }
              }, 1000);
              return;
            }

            this.logger.log(
              `[Negocio ${sesion.negocioId}] Tiempo de escaneo de QR expirado sin interacción. Entrando en REPOSO hasta nueva solicitud del frontend.`,
            );
            sesion.enReposo = true;
            sesion.qrDataUrl = null;
            this.limpiarCarpetaSesionIncompleta(sesion);
          }
        })();
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

  getStatus(negocioId: number): { conectado: boolean; qr: string | null } {
    const sesion = this.obtenerOCrearSesion(negocioId);
    return {
      conectado: sesion.isConnected,
      qr: sesion.isConnected ? null : sesion.qrDataUrl,
    };
  }

  hayAlgunaSesionConectada(): boolean {
    for (const sesion of this.sesiones.values()) {
      if (sesion.isConnected) return true;
    }
    return false;
  }

  pausar(
    negocioId: number,
    tieneSesionGuardadaFn: (id: number) => boolean = (id) =>
      this.tieneSesionGuardada(id),
  ): { mensaje: string } {
    const sesion = this.obtenerOCrearSesion(negocioId);

    if (!sesion.isConnected && !tieneSesionGuardadaFn(negocioId)) {
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

  async desconectar(negocioId: number): Promise<{ mensaje: string }> {
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
}

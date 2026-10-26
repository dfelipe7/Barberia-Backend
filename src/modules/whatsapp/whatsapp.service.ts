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

  constructor(
    private readonly prisma: PrismaService,
    private readonly plantillasRepository: WhatsAppPlantillasRepository,
    private readonly configuracionService: ConfiguracionService,
    private readonly contextoService: NegocioContextoService,
    private readonly negociosRepository: NegociosRepository,
    private readonly perfilNegocioService: PerfilNegocioService,
  ) {
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
      .replace(/{negocio}/g, nombreNegocio)
      .replace(
        /📍 \*Ubicación:\* \{ubicacion\}\n?/g,
        direccion ? `📍 *Ubicación:* ${direccion}\n` : '',
      );

    return conComerciales
      .replace(/{cliente}/g, datos.clienteNombre)
      .replace(/{servicio}/g, datos.servicioNombre)
      .replace(/{barbero}/g, datos.barberoNombre)
      .replace(/{fecha}/g, datos.fecha)
      .replace(/{hora}/g, datos.hora)
      .replace(/{precio}/g, precioTexto)
      .replace(/{ubicacion}/g, direccion);
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
      const parsed = parseInt(plantilla.mensaje, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
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
   * Actualiza o crea las plantillas de mensajes y configuración en la base de
   * datos.
   *
   * HU-11: las plantillas se guardan PARA EL NEGOCIO DEL CONTEXTO. Sin
   * contexto (operación de plataforma) se guardan como plantillas GLOBALES.
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
   * Restablece las plantillas a los textos oficiales por defecto.
   *
   * HU-11: se eliminan las plantillas DEL NEGOCIO DEL CONTEXTO (las globales
   * se conservan: son el valor por defecto de la plataforma). Sin contexto se
   * eliminan las globales.
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
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía el recordatorio automático antes de la cita usando la plantilla
   * configurada.
   */
  async enviarRecordatorioReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const { recordatorio } = await this.obtenerPlantillas();
    const comercial = await this.datosComercialesDelNegocio();
    const mensaje = this.reemplazarVariables(recordatorio, datos, comercial);
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía notificación cuando la cita es cancelada.
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

    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía notificación cuando la cita es marcada como completada.
   */
  async enviarCompletadoReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const comercial = await this.datosComercialesDelNegocio();

    const mensaje =
      `✅ *CITA COMPLETADA - ${comercial.nombre}*\n` +
      `¡Hola ${datos.clienteNombre}! Tu cita de ${datos.servicioNombre} del día *${datos.fecha}* a las *${datos.hora}* ha sido marcada como completada.\n\n` +
      `¡Gracias por tu visita! Esperamos verte de nuevo pronto en ${comercial.nombre}.`;

    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía notificación cuando la cita es reprogramada/modificada.
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

    return this.enviarMensaje(datos.telefono, mensaje);
  }
}

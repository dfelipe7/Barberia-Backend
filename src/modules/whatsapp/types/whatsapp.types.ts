import type { WASocket } from '@whiskeysockets/baileys';

/**
 * Plantilla por defecto para confirmación inmediata de reserva.
 */
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

/**
 * Plantilla por defecto para recordatorio automático de cita.
 */
export const PLANTILLA_RECORDATORIO_DEFAULT =
  `⏰ *RECORDATORIO DE TU CITA - {negocio}*\n` +
  `¡Hola {cliente}! Te recordamos que tienes una cita programada para hoy:\n\n` +
  `⏰ *Hora:* {hora}\n` +
  `✂️ *Servicio:* {servicio}\n` +
  `💈 *Barbero:* {barbero}\n\n` +
  `📍 *Ubicación:* {ubicacion}\n` +
  `_Si no puedes asistir o necesitas reprogramar, por favor avísanos con tiempo._`;

export const MINUTOS_ANTICIPACION_DEFAULT = 120;

/**
 * Parámetros requeridos para construir y emitir notificaciones de reservas por WhatsApp.
 */
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
 * Estructura de mensaje almacenado en cola cuando WhatsApp está desconectado.
 */
export interface MensajeColaWhatsApp {
  reservaId: number;
  negocioId: number;
  tipo: 'CONFIRMACION' | 'REPROGRAMACION';
  telefono: string;
  payload: DatosConfirmacionWhatsApp;
  creadoEn: number;
  caducaEn: number;
  horaInicioCitaMs: number;
}

/**
 * Estado y socket activo de una barbería en el pool de sesiones multi-tenant.
 */
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

/**
 * DTO informativo del estado de conexión de WhatsApp para el frontend.
 */
export interface EstadoWhatsAppDTO {
  conectado: boolean;
  tieneSesionGuardada: boolean;
  qr: string | null;
  enReposo?: boolean;
}

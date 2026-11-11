import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MensajeColaWhatsApp } from '../types/whatsapp.types';

/**
 * Gestor en memoria de la cola de mensajes pendientes para despachos resilientes de WhatsApp.
 */
export class WhatsAppQueueManager {
  private readonly logger = new Logger(WhatsAppQueueManager.name);
  private readonly colasPendientes = new Map<number, MensajeColaWhatsApp[]>();

  /**
   * Expone el mapa interno de colas para interoperabilidad y pruebas unitarias.
   */
  get colas(): Map<number, MensajeColaWhatsApp[]> {
    return this.colasPendientes;
  }

  /**
   * Encola un mensaje en memoria para ser despachado cuando el socket se reconecte.
   * Si ya existía un mensaje para la misma reserva, lo reemplaza con los datos más recientes.
   */
  encolar(mensaje: MensajeColaWhatsApp): void {
    const cola = this.colasPendientes.get(mensaje.negocioId) ?? [];
    const filtrada = cola.filter((m) => m.reservaId !== mensaje.reservaId);
    filtrada.push(mensaje);
    this.colasPendientes.set(mensaje.negocioId, filtrada);
    this.logger.log(
      `[Negocio ${mensaje.negocioId}] Mensaje de ${mensaje.tipo} para reserva #${mensaje.reservaId} guardado en cola de espera (Total en cola: ${filtrada.length}).`,
    );
  }

  /**
   * Elimina cualquier mensaje en cola asociado a una reserva.
   */
  cancelarPorReserva(reservaId: number, negocioId: number): void {
    const cola = this.colasPendientes.get(negocioId);
    if (!cola || cola.length === 0) return;

    const filtrada = cola.filter((m) => m.reservaId !== reservaId);
    if (filtrada.length !== cola.length) {
      this.colasPendientes.set(negocioId, filtrada);
      this.logger.log(
        `[Negocio ${negocioId}] Purgados mensajes pendientes de reserva #${reservaId} en cola de espera.`,
      );
    }
  }

  /**
   * Obtiene la cola actual de un negocio y la vacía de forma atómica.
   */
  extraerCola(negocioId: number): MensajeColaWhatsApp[] {
    const cola = this.colasPendientes.get(negocioId) ?? [];
    this.colasPendientes.set(negocioId, []);
    return cola;
  }

  /**
   * Valida si un mensaje encolado aún debe ser enviado (Just-in-Time check en BD + TTL).
   */
  async esMensajeValidoParaDespachar(
    prisma: PrismaService,
    mensaje: MensajeColaWhatsApp,
    ahora: number,
  ): Promise<boolean> {
    if (ahora > mensaje.caducaEn) {
      this.logger.warn(
        `[Negocio ${mensaje.negocioId}] Descartando ${mensaje.tipo} reserva #${mensaje.reservaId}: expiró TTL de 60 min.`,
      );
      return false;
    }

    if (ahora >= mensaje.horaInicioCitaMs) {
      this.logger.warn(
        `[Negocio ${mensaje.negocioId}] Descartando ${mensaje.tipo} reserva #${mensaje.reservaId}: la hora de la cita ya inició o pasó.`,
      );
      return false;
    }

    try {
      const reservaDb = await prisma.reservation.findUnique({
        where: { id: mensaje.reservaId },
        select: { status: true },
      });

      if (
        !reservaDb ||
        (reservaDb.status !== 'PENDING' && reservaDb.status !== 'CONFIRMED')
      ) {
        this.logger.log(
          `[Negocio ${mensaje.negocioId}] Descartando ${mensaje.tipo} reserva #${mensaje.reservaId}: estado es '${reservaDb?.status ?? 'ELIMINADA'}'.`,
        );
        return false;
      }
    } catch (err: unknown) {
      this.logger.warn(
        `[Negocio ${mensaje.negocioId}] Error verificando reserva #${mensaje.reservaId}: ${(err as Error)?.message ?? String(err)}`,
      );
    }

    return true;
  }
}

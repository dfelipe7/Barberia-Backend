import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReservasRepository } from '../repository/reservas.repository';
import { WhatsAppService, enmascararTelefono } from '../../whatsapp/whatsapp.service';
import { FechaBogotaService } from '../../horarios/common/fecha-bogota.service';

@Injectable()
export class RecordatoriosCron {
  private readonly logger = new Logger(RecordatoriosCron.name);

  constructor(
    private readonly reservasRepository: ReservasRepository,
    private readonly whatsappService: WhatsAppService,
    private readonly fechaBogotaService: FechaBogotaService,
  ) {}

  /**
   * Tarea programada ejecutada cada 10 minutos.
   * Busca citas programadas para el día de hoy que inicien dentro de las próximas 2 horas
   * (0 a 120 minutos) y envía el recordatorio por WhatsApp.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async procesarRecordatorios() {
    try {
      const { conectado } = this.whatsappService.getStatus();
      if (!conectado) {
        // Si WhatsApp no está enlazado, se omite el ciclo sin generar errores.
        return;
      }

      const componentes = this.fechaBogotaService.obtenerComponentesBogota(new Date());
      const fechaBogotaStr = componentes.fecha;
      const fechaDate = new Date(`${fechaBogotaStr}T00:00:00.000Z`);
      const ahoraMinutos = componentes.hora24 * 60 + componentes.minuto;

      const reservasPendientes =
        await this.reservasRepository.obtenerCitasPendientesRecordatorio(fechaDate);

      if (!reservasPendientes || reservasPendientes.length === 0) {
        return;
      }

      this.logger.log(
        `[CRON RECORDATORIOS] Analizando ${reservasPendientes.length} citas de hoy (${fechaBogotaStr}) para recordatorio WhatsApp...`,
      );

      const minutosAnticipacion =
        typeof this.whatsappService.obtenerMinutosAnticipacion === 'function'
          ? await this.whatsappService.obtenerMinutosAnticipacion()
          : 120;

      for (const reserva of reservasPendientes) {
        const [horaCita, minutoCita] = reserva.startTime.split(':').map(Number);
        const citaMinutos = horaCita * 60 + minutoCita;
        const diferenciaMinutos = citaMinutos - ahoraMinutos;

        // Si la cita está dentro de la ventana de anticipación configurada (0 a N minutos)
        if (diferenciaMinutos >= 0 && diferenciaMinutos <= minutosAnticipacion) {
          const telefono = reserva.cliente?.telefono;
          const clienteNombre =
            `${reserva.cliente?.nombre ?? ''} ${reserva.cliente?.apellido ?? ''}`.trim() ||
            'Cliente';
          const barberoNombre =
            `${reserva.barbero?.usuario?.nombre ?? ''} ${reserva.barbero?.usuario?.apellido ?? ''}`.trim() ||
            'Barbero';
          const servicioNombre = reserva.servicio?.nombre ?? 'Servicio';

          if (telefono) {
            this.logger.log(
              `[CRON RECORDATORIOS] Enviando recordatorio para cita #${reserva.id} a ${clienteNombre} (${enmascararTelefono(telefono)})`,
            );

            await this.whatsappService.enviarRecordatorioReserva({
              telefono,
              clienteNombre,
              servicioNombre,
              barberoNombre,
              fecha: fechaBogotaStr,
              hora: reserva.startTime,
              precio: reserva.precioReservado
                ? Number(reserva.precioReservado)
                : reserva.servicio?.precio
                  ? Number(reserva.servicio.precio)
                  : null,
            });
          }

          // Se marca como enviado para garantizar idempotencia y no repetir recordatorio
          await this.reservasRepository.marcarRecordatorioEnviado(reserva.id);
        }
      }
    } catch (error) {
      this.logger.error('[CRON RECORDATORIOS] Error durante la ejecución del cron de WhatsApp:', error);
    }
  }
}

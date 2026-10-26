import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReservasRepository } from '../repository/reservas.repository';
import {
  WhatsAppService,
  enmascararTelefono,
} from '../../whatsapp/whatsapp.service';
import { FechaBogotaService } from '../../horarios/common/fecha-bogota.service';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { NegociosRepository } from '../../negocios/repository/negocios.repository';
import { EstadoNegocio } from '../../../../generated/prisma/enums';

/**
 * Tarea programada de recordatorios de cita (HU-11).
 *
 * AISLAMIENTO POR NEGOCIO
 * -----------------------
 * El cron es un proceso en segundo plano: NO pasa por el middleware HTTP, así
 * que establece su propio contexto de negocio con
 * `NegocioContextoService.ejecutarEnContexto`.
 *
 * El flujo es:
 *   1. Se seleccionan los negocios ACTIVOS con una consulta GLOBAL de
 *      plataforma (no se mezclan datos operativos de un tenant con esta
 *      consulta).
 *   2. Cada negocio se procesa DENTRO de su propio contexto, con TODAS sus
 *      esperas dentro: las reservas, la plantilla, la configuración y la
 *      marca de "recordatorio enviado" quedan acotadas a ese negocio.
 *   3. Un error en un negocio NO impide procesar los demás: se registra y se
 *      continúa con el siguiente.
 *
 * IDEMPOTENCIA
 * ------------
 * La marca `recordatorioEnviado` se escribe dentro del contexto del negocio y
 * la consulta de pendientes exige `recordatorioEnviado = false`, de modo que
 * una segunda pasada no repite el mensaje. La protección es "en el mejor de
 * los casos": el filtro y la marca no son atómicos, así que dos ejecuciones
 * simultáneas del cron sobre la misma franja PODRÍAN duplicar un recordatorio.
 * El índice único de ocupación (`reservations_barberoId_date_startTime_
 * slotActivo_key`) impide la doble reserva, no el doble recordatorio.
 */
@Injectable()
export class RecordatoriosCron {
  private readonly logger = new Logger(RecordatoriosCron.name);

  constructor(
    private readonly reservasRepository: ReservasRepository,
    private readonly whatsappService: WhatsAppService,
    private readonly fechaBogotaService: FechaBogotaService,
    private readonly contextoService: NegocioContextoService,
    private readonly negociosRepository: NegociosRepository,
  ) {}

  /**
   * Tarea programada ejecutada cada 10 minutos.
   * Busca citas programadas para el día de hoy que inicien dentro de la ventana
   * de anticipación configurada por el negocio y envía el recordatorio.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async procesarRecordatorios(): Promise<void> {
    try {
      const { conectado } = this.whatsappService.getStatus();
      if (!conectado) {
        // Si WhatsApp no está enlazado, se omite el ciclo sin generar errores.
        return;
      }

      const componentes = this.fechaBogotaService.obtenerComponentesBogota(
        new Date(),
      );
      const fechaBogotaStr = componentes.fecha;
      const fechaDate = new Date(`${fechaBogotaStr}T00:00:00.000Z`);
      const ahoraMinutos = componentes.hora24 * 60 + componentes.minuto;

      // Selección GLOBAL de los negocios a procesar. No mezcla datos
      // operativos de un tenant: solo devuelve identidad y estado.
      const negocios = await this.negociosRepository.listar();
      const activos = negocios.filter(
        (negocio) => negocio.estado === EstadoNegocio.ACTIVO,
      );

      if (activos.length === 0) {
        this.logger.log(
          '[CRON RECORDATORIOS] No hay negocios activos: no hay recordatorios que enviar.',
        );
        return;
      }

      this.logger.log(
        `[CRON RECORDATORIOS] Procesando recordatorios de ${activos.length} negocio(s) activo(s) para ${fechaBogotaStr}...`,
      );

      for (const negocio of activos) {
        try {
          // El contexto se establece AQUÍ y se mantiene durante TODAS las
          // esperas de este negocio: ninguna consulta ni escritura sale de su
          // ámbito, y el contexto de un negocio no se reutiliza para otro.
          await this.contextoService.ejecutarEnContexto(negocio, async () => {
            await this.procesarRecordatoriosDelNegocio(
              negocio,
              fechaDate,
              fechaBogotaStr,
              ahoraMinutos,
            );
          });
        } catch (error) {
          // El fallo de un negocio NO detiene el procesamiento de los demás.
          this.logger.error(
            `[CRON RECORDATORIOS] Error procesando el negocio ${negocio.slug} (id=${negocio.id}):`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        '[CRON RECORDATORIOS] Error durante la ejecución del cron de WhatsApp:',
        error,
      );
    }
  }

  /**
   * Procesa los recordatorios de UN negocio, con el contexto ya establecido.
   *
   * Todas las esperas ocurren dentro del callback de contexto: Prisma devuelve
   * promesas perezosas y, si se esperasen fuera, la consulta se ejecutaría ya
   * fuera del ámbito del negocio.
   */
  private async procesarRecordatoriosDelNegocio(
    negocio: { id: number; slug: string },
    fechaDate: Date,
    fechaBogotaStr: string,
    ahoraMinutos: number,
  ): Promise<void> {
    const reservasPendientes =
      await this.reservasRepository.obtenerCitasPendientesRecordatorio(
        fechaDate,
      );

    if (!reservasPendientes || reservasPendientes.length === 0) {
      return;
    }

    // La anticipación es una POLÍTICA del negocio (su configuración), no un
    // valor global.
    const minutosAnticipacion =
      await this.whatsappService.obtenerMinutosAnticipacion();

    this.logger.log(
      `[CRON RECORDATORIOS] Negocio ${negocio.slug}: ${reservasPendientes.length} cita(s) para ${fechaDate.toISOString().slice(0, 10)} (ventana de ${minutosAnticipacion} min).`,
    );

    for (const reserva of reservasPendientes) {
      const [horaCita, minutoCita] = reserva.startTime.split(':').map(Number);
      const citaMinutos = horaCita * 60 + minutoCita;
      const diferenciaMinutos = citaMinutos - ahoraMinutos;

      // Si la cita está dentro de la ventana de anticipación configurada.
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
            `[CRON RECORDATORIOS] [${negocio.slug}] Enviando recordatorio para la cita #${reserva.id} a ${clienteNombre} (${enmascararTelefono(telefono)})`,
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

        // Se marca como enviado para garantizar idempotencia y no repetir
        // recordatorio. La escritura queda acotada al negocio del contexto.
        await this.reservasRepository.marcarRecordatorioEnviado(reserva.id);
      }
    }
  }
}

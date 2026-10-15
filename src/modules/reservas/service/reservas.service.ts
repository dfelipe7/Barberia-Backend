import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { WeekDay } from '../../../../generated/prisma/enums';
import { CrearReservaDto } from '../dto/dto-peticion/crear-reserva.dto';
import { ReservaCreadaResponseDto } from '../dto/dto-respuesta/reserva-creada-response.dto';
import {
  ClienteDeReserva,
  CrearReservaDatos,
  ReservaRegistro,
  ReservasRepository,
} from '../repository/reservas.repository';
import { ClientesRepository } from '../repository/clientes.repository';
import { DisponibilidadService } from '../../horarios/service/disponibilidad.service';
import { EstadoFranja } from '../../horarios/common/estado-franja';
import type { FranjaEvaluada } from '../../horarios/common/estado-franja';
import { FechaBogotaService } from '../../horarios/common/fecha-bogota.service';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';

/** Mensajes de dominio exigidos por los criterios de aceptación (Excel HE-04). */
export const MENSAJE_RESERVA_CREADA = 'Reserva creada exitosamente';
export const MENSAJE_FRANJA_OCUPADA =
  'El horario seleccionado ya no está disponible. Por favor selecciona otro horario';
export const MENSAJE_RESERVA_DUPLICADA =
  'Ya tienes una reserva registrada para este horario';

/**
 * Identidad de un cliente autenticado resuelta desde el token. Es el único
 * insumo que distingue la Modalidad B de la Modalidad A; el resto del flujo de
 * creación es idéntico.
 */
export interface IdentidadClienteAutenticado {
  usuarioId: number;
  nombre: string;
  apellido: string;
}

/**
 * Servicio de aplicación de HE-04 (creación de reservas, HU-04/HU-10).
 *
 * Orquesta, sin duplicar reglas:
 * 1. validación de fecha y modalidad de cliente (invitado / autenticado);
 * 2. duplicado del propio cliente (CA-04);
 * 3. disponibilidad como fuente única de verdad (HE-08, `DisponibilidadService`);
 * 4. creación atómica de cliente + reserva con bloqueo y unicidad de franja;
 * 5. traducción de conflictos de concurrencia a 409.
 *
 * El precio y la duración NUNCA se reciben del cliente: se resuelven desde el
 * `Servicio` vigente para la confirmación.
 */
@Injectable()
export class ReservasService {
  private readonly logger = new Logger(ReservasService.name);

  constructor(
    private readonly reservasRepository: ReservasRepository,
    private readonly clientesRepository: ClientesRepository,
    private readonly disponibilidadService: DisponibilidadService,
    private readonly serviciosRepository: ServiciosRepository,
    private readonly fechaBogotaService: FechaBogotaService,
  ) {}

  /**
   * Crea una reserva para servicio, barbero, fecha y hora.
   *
   * @param dto datos obligatorios + contacto del invitado (si aplica).
   * @param identidad cliente autenticado (Modalidad B) o `undefined` (invitado).
   */
  async crearReserva(
    dto: CrearReservaDto,
    identidad?: IdentidadClienteAutenticado,
  ): Promise<ReservaCreadaResponseDto> {
    this.validarFecha(dto.fecha);

    const cliente = await this.resolverCliente(dto, identidad);

    // CA-04: el mismo cliente no puede duplicar la reserva de la franja.
    if (cliente.clienteIdConocido !== null) {
      const duplicada =
        await this.reservasRepository.existeReservaActivaDeClienteEnFranja({
          clienteId: cliente.clienteIdConocido,
          barberoId: dto.barberoId,
          fecha: this.aFechaDate(dto.fecha),
          startTime: dto.hora,
        });

      if (duplicada) {
        throw new ConflictException(MENSAJE_RESERVA_DUPLICADA);
      }
    }

    // Fuente única de verdad (HE-08): valida servicio/barbero/asignación/fecha y
    // devuelve el estado real de cada franja.
    const franja = await this.obtenerFranjaDisponible(
      dto.barberoId,
      dto.servicioId,
      dto.fecha,
      dto.hora,
    );

    const reserva = await this.crearConManejoDeConflicto({
      barberoId: dto.barberoId,
      servicioId: dto.servicioId,
      date: this.aFechaDate(dto.fecha),
      dayOfWeek: this.fechaBogotaService.obtenerDiaSemana(dto.fecha) as WeekDay,
      startTime: franja.startTime,
      endTime: franja.endTime,
      cliente: cliente.clienteDeReserva,
    });

    this.logger.log(
      `AUDIT: reserva creada id=${reserva.id} barberoId=${reserva.barberoId} servicioId=${reserva.servicioId} clienteId=${reserva.clienteId} autenticado=${identidad ? 'si' : 'no'}`,
    );

    return this.construirRespuesta(reserva, dto.fecha);
  }

  /**
   * Resuelve la modalidad de cliente sin persistir nada todavía:
   * - Autenticado con `Cliente` previo → reutiliza `clienteId` (no duplica).
   * - Autenticado sin `Cliente` previo → se creará vinculado al `Usuario`.
   * - Invitado → exige nombre y teléfono y se creará sin `usuarioId`.
   */
  private async resolverCliente(
    dto: CrearReservaDto,
    identidad?: IdentidadClienteAutenticado,
  ): Promise<{
    clienteDeReserva: ClienteDeReserva;
    clienteIdConocido: number | null;
  }> {
    if (identidad) {
      const existente = await this.clientesRepository.buscarPorUsuarioId(
        identidad.usuarioId,
      );

      if (existente) {
        return {
          clienteDeReserva: { clienteId: existente.id },
          clienteIdConocido: existente.id,
        };
      }

      return {
        clienteDeReserva: {
          crear: {
            nombre: identidad.nombre,
            apellido: identidad.apellido,
            telefono: dto.telefono ?? null,
            usuarioId: identidad.usuarioId,
          },
        },
        clienteIdConocido: null,
      };
    }

    if (!dto.nombre || !dto.telefono) {
      throw new BadRequestException(
        'Para reservar sin iniciar sesión debes indicar al menos tu nombre y un número de contacto',
      );
    }

    return {
      clienteDeReserva: {
        crear: {
          nombre: dto.nombre,
          apellido: dto.apellido ?? null,
          telefono: dto.telefono,
        },
      },
      clienteIdConocido: null,
    };
  }

  /**
   * Consulta la disponibilidad (HE-08) y exige que la franja solicitada esté
   * `AVAILABLE`. Distingue una hora fuera de la jornada/catálogo (400) de una
   * franja ocupada, bloqueada, cerrada o fuera de horario (409).
   */
  private async obtenerFranjaDisponible(
    barberoId: number,
    servicioId: number,
    fecha: string,
    hora: string,
  ): Promise<FranjaEvaluada> {
    const franjas = await this.disponibilidadService.calcularDisponibilidad({
      barberoId,
      servicioId,
      fecha,
    });

    const franja = franjas.find((f) => f.startTime === hora);

    if (!franja) {
      throw new BadRequestException(
        `La hora "${hora}" no corresponde a una franja válida de la jornada`,
      );
    }

    if (franja.estado !== EstadoFranja.AVAILABLE) {
      throw new ConflictException(MENSAJE_FRANJA_OCUPADA);
    }

    return franja;
  }

  /**
   * Crea la reserva traduciendo la violación de unicidad (`P2002`) a un 409 con
   * el mensaje de CA-03. La garantía real contra el doble booking es el índice
   * UNIQUE de la base (D-17); el chequeo previo de disponibilidad no basta para
   * dos peticiones concurrentes.
   */
  private async crearConManejoDeConflicto(
    datos: CrearReservaDatos,
  ): Promise<ReservaRegistro> {
    try {
      return await this.reservasRepository.crearConBloqueo(datos);
    } catch (error) {
      if (this.esViolacionUnicidad(error)) {
        throw new ConflictException(MENSAJE_FRANJA_OCUPADA);
      }
      throw error;
    }
  }

  /** Construye la confirmación con datos del servidor (nunca del cliente). */
  private async construirRespuesta(
    reserva: ReservaRegistro,
    fecha: string,
  ): Promise<ReservaCreadaResponseDto> {
    const servicio = await this.serviciosRepository.obtenerServicioActivoPorId(
      reserva.servicioId,
    );

    if (!servicio) {
      throw new NotFoundException(
        `El servicio ${reserva.servicioId} no existe o no está activo`,
      );
    }

    const barberos =
      await this.serviciosRepository.listarBarberosActivosPorServicio(
        reserva.servicioId,
      );
    const barbero = barberos.find(
      (candidato) => candidato.id === reserva.barberoId,
    );

    if (!barbero) {
      throw new NotFoundException(
        `El barbero ${reserva.barberoId} no presta el servicio ${reserva.servicioId}`,
      );
    }

    return {
      mensaje: MENSAJE_RESERVA_CREADA,
      id: reserva.id,
      estado: reserva.status,
      fecha,
      hora: reserva.startTime,
      horaFin: reserva.endTime,
      barbero: {
        id: barbero.id,
        nombre: barbero.usuario.nombre,
        apellido: barbero.usuario.apellido,
      },
      servicio: {
        id: servicio.id,
        nombre: servicio.nombre,
        precio: Number(servicio.precio),
        duracionMinutos: servicio.duracionMinutos,
      },
    };
  }

  private validarFecha(fecha: string): void {
    if (!this.fechaBogotaService.esFechaCalendarioValida(fecha)) {
      throw new BadRequestException(
        `Fecha inválida: "${fecha}". Se esperaba una fecha de calendario YYYY-MM-DD`,
      );
    }
  }

  private aFechaDate(fecha: string): Date {
    return new Date(`${fecha}T00:00:00.000Z`);
  }

  private esViolacionUnicidad(error: unknown): boolean {
    return (error as { code?: unknown } | null)?.code === 'P2002';
  }
}

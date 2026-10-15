import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CrearReservaDto } from '../dto/dto-peticion/crear-reserva.dto';
import { ReservaCreadaResponseDto } from '../dto/dto-respuesta/reserva-creada-response.dto';
import { ReservaClienteDto } from '../dto/dto-respuesta/reserva-cliente.dto';
import { MisReservasResponseDto } from '../dto/dto-respuesta/mis-reservas-response.dto';
import {
  ClienteDeReserva,
  CrearReservaDatos,
  ReservaConRelaciones,
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
export const MENSAJE_SIN_RESERVAS = 'No tienes reservas registradas';
export const MENSAJE_RESERVA_NO_DISPONIBLE =
  'La reserva no se encuentra disponible';

/**
 * Identidad de un cliente autenticado resuelta desde su token de cliente. Es el
 * único insumo que distingue la Modalidad B de la Modalidad A; el `clienteId`
 * proviene de la base de datos (nunca del frontend).
 */
export interface IdentidadClienteAutenticado {
  clienteId: number;
}

/**
 * Servicio de aplicación de HE-04 (creación de reservas HU-04 y consultas del
 * cliente HU-06/HU-07).
 *
 * Orquesta, sin duplicar reglas:
 * 1. validación de fecha y modalidad de cliente (invitado / autenticado);
 * 2. duplicado del propio cliente (CA-04);
 * 3. disponibilidad como fuente única de verdad (HE-08, `DisponibilidadService`);
 * 4. creación atómica de cliente + reserva con bloqueo y unicidad de franja;
 * 5. traducción de conflictos de concurrencia a 409;
 * 6. consulta de las reservas propias y de su detalle (HU-06/HU-07).
 *
 * El precio y la duración NUNCA se reciben del cliente: el precio se resuelve del
 * `Servicio` vigente al crear y se conserva en la reserva (`precioReservado`).
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

    const servicio = await this.obtenerServicio(dto.servicioId);

    const reserva = await this.crearConManejoDeConflicto({
      barberoId: dto.barberoId,
      servicioId: dto.servicioId,
      date: this.aFechaDate(dto.fecha),
      dayOfWeek: this.fechaBogotaService.obtenerDiaSemana(dto.fecha),
      startTime: franja.startTime,
      endTime: franja.endTime,
      // Precio histórico calculado en el servidor, no confiado al cliente.
      precioReservado: Number(servicio.precio),
      cliente: cliente.clienteDeReserva,
    });

    this.logger.log(
      `AUDIT: reserva creada id=${reserva.id} barberoId=${reserva.barberoId} servicioId=${reserva.servicioId} clienteId=${reserva.clienteId} autenticado=${identidad ? 'si' : 'no'}`,
    );

    return this.construirRespuesta(reserva, dto.fecha, servicio);
  }

  /**
   * HU-06: devuelve las reservas del cliente autenticado, próximas primero.
   * Sin reservas, responde con lista vacía y el mensaje exacto de CA-02.
   */
  async listarMisReservas(
    identidad: IdentidadClienteAutenticado,
  ): Promise<MisReservasResponseDto> {
    await this.asegurarClienteVigente(identidad.clienteId);

    const reservas = await this.reservasRepository.listarReservasDeCliente(
      identidad.clienteId,
    );

    const ordenadas = this.ordenarProximasPrimero(reservas);

    if (ordenadas.length === 0) {
      return { mensaje: MENSAJE_SIN_RESERVAS, reservas: [] };
    }

    return { reservas: ordenadas.map((r) => this.aReservaCliente(r)) };
  }

  /**
   * HU-07: devuelve el detalle de una reserva propia. Si la reserva no existe o
   * pertenece a otro cliente, responde el mismo 404 con el mensaje exacto de
   * CA-02, sin revelar la existencia de reservas ajenas.
   */
  async obtenerMiReserva(
    identidad: IdentidadClienteAutenticado,
    reservaId: number,
  ): Promise<ReservaClienteDto> {
    await this.asegurarClienteVigente(identidad.clienteId);

    const reserva = await this.reservasRepository.obtenerReservaDeCliente(
      identidad.clienteId,
      reservaId,
    );

    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    return this.aReservaCliente(reserva);
  }

  /**
   * Resuelve la modalidad de cliente sin persistir nada todavía:
   * - Autenticado → usa su `clienteId` (ya existe en la base; el alta ocurrió en
   *   el login con Google). No se confía en ningún id del frontend.
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
      const existente = await this.clientesRepository.obtenerPorId(
        identidad.clienteId,
      );

      if (!existente) {
        throw new UnauthorizedException(
          'La sesión de cliente ya no es válida. Inicia sesión de nuevo.',
        );
      }

      return {
        clienteDeReserva: { clienteId: existente.id },
        clienteIdConocido: existente.id,
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

  /** Resuelve el servicio activo o falla con 404 si no existe/no está activo. */
  private async obtenerServicio(servicioId: number) {
    const servicio =
      await this.serviciosRepository.obtenerServicioActivoPorId(servicioId);

    if (!servicio) {
      throw new NotFoundException(
        `El servicio ${servicioId} no existe o no está activo`,
      );
    }

    return servicio;
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
    servicio: {
      id: number;
      nombre: string;
      precio: unknown;
      duracionMinutos: number;
    },
  ): Promise<ReservaCreadaResponseDto> {
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

  /** Traduce una reserva persistida al DTO propio del cliente. */
  private aReservaCliente(reserva: ReservaConRelaciones): ReservaClienteDto {
    return {
      id: reserva.id,
      estado: reserva.status,
      fecha: this.aFechaCalendario(reserva.date),
      hora: reserva.startTime,
      horaFin: reserva.endTime,
      // Precio histórico; si es anterior al registro del precio, se usa el
      // vigente del servicio como respaldo documentado.
      precio: Number(reserva.precioReservado ?? reserva.servicio.precio),
      barbero: {
        id: reserva.barbero.id,
        nombre: reserva.barbero.usuario.nombre,
        apellido: reserva.barbero.usuario.apellido,
      },
      servicio: {
        id: reserva.servicio.id,
        nombre: reserva.servicio.nombre,
      },
    };
  }

  /**
   * Ordena las reservas "próximas primero": primero las futuras (y las de hoy
   * cuya hora aún no pasó) de más cercana a más lejana, y después las pasadas,
   * de la más reciente a la más antigua. La comparación se hace en Bogotá.
   */
  private ordenarProximasPrimero(
    reservas: ReservaConRelaciones[],
  ): ReservaConRelaciones[] {
    const ahora = new Date();
    const claveAhora = `${this.fechaBogotaService.obtenerFechaBogota(ahora)}T${this.fechaBogotaService.obtenerHoraBogota(ahora)}`;

    const claveReserva = (reserva: ReservaConRelaciones): string =>
      `${this.aFechaCalendario(reserva.date)}T${reserva.startTime}`;

    const proximas = reservas
      .filter((r) => claveReserva(r) >= claveAhora)
      .sort((a, b) => claveReserva(a).localeCompare(claveReserva(b)));

    const pasadas = reservas
      .filter((r) => claveReserva(r) < claveAhora)
      .sort((a, b) => claveReserva(b).localeCompare(claveReserva(a)));

    return [...proximas, ...pasadas];
  }

  /** Verifica que el cliente de la sesión siga existiendo. */
  private async asegurarClienteVigente(clienteId: number): Promise<void> {
    const cliente = await this.clientesRepository.obtenerPorId(clienteId);
    if (!cliente) {
      throw new UnauthorizedException(
        'La sesión de cliente ya no es válida. Inicia sesión de nuevo.',
      );
    }
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

  /**
   * Fecha de calendario (`YYYY-MM-DD`) de una reserva. `date` se persiste como
   * `@db.Date` a medianoche UTC, por lo que el corte ISO es estable.
   */
  private aFechaCalendario(fecha: Date): string {
    return fecha.toISOString().slice(0, 10);
  }

  private esViolacionUnicidad(error: unknown): boolean {
    return (error as { code?: unknown } | null)?.code === 'P2002';
  }
}

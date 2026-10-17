import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { EstadoUsuario, ReservationStatus } from '../../../../generated/prisma/enums';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { CrearReservaDto } from '../dto/dto-peticion/crear-reserva.dto';
import { ModificarReservaDto } from '../dto/dto-peticion/modificar-reserva.dto';
import { ConsultaAgendaBarberoDto } from '../dto/dto-peticion/consulta-agenda-barbero.dto';
import { ConsultaAgendaSemanalDto } from '../dto/dto-peticion/consulta-agenda-semanal.dto';
import { ReservaCreadaResponseDto } from '../dto/dto-respuesta/reserva-creada-response.dto';
import { ReservaModificadaResponseDto } from '../dto/dto-respuesta/reserva-modificada-response.dto';
import { ReservaCanceladaResponseDto } from '../dto/dto-respuesta/reserva-cancelada-response.dto';
import { ReservaClienteDto } from '../dto/dto-respuesta/reserva-cliente.dto';
import { MisReservasResponseDto } from '../dto/dto-respuesta/mis-reservas-response.dto';
import {
  AgendaBarberoResponseDto,
  AgendaSemanalBarberoResponseDto,
  CitaAgendaBarberoDto,
} from '../dto/dto-respuesta/agenda-barbero-response.dto';
import {
  ClienteDeReserva,
  CrearReservaDatos,
  MENSAJE_HORARIO_NO_DISPONIBLE,
  ModificarReservaDatos,
  ReservaAgendaRegistro,
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
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';

/** Mensajes de dominio exigidos por los criterios de aceptación (Excel HE-04). */
export const MENSAJE_RESERVA_CREADA = 'Reserva creada exitosamente';
export const MENSAJE_RESERVA_MODIFICADA = 'Reserva modificada correctamente';
export const MENSAJE_RESERVA_CANCELADA = 'Reserva cancelada correctamente';
export const MENSAJE_FRANJA_OCUPADA =
  'El horario seleccionado ya no está disponible. Por favor selecciona otro horario';
export { MENSAJE_HORARIO_NO_DISPONIBLE };
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
    private readonly barberosRepository: BarberosRepository,
    @Optional() private readonly whatsappService?: WhatsAppService,
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

    let tokenGestion: string | undefined;
    let gestionTokenHash: string | undefined;

    if (!identidad) {
      tokenGestion = this.generarTokenGestion();
      gestionTokenHash = this.hashearToken(tokenGestion);
    }

    const reserva = await this.crearConManejoDeConflicto({
      barberoId: dto.barberoId,
      servicioId: dto.servicioId,
      date: this.aFechaDate(dto.fecha),
      dayOfWeek: this.fechaBogotaService.obtenerDiaSemana(dto.fecha),
      startTime: franja.startTime,
      endTime: franja.endTime,
      // Precio histórico calculado en el servidor, no confiado al cliente.
      precioReservado: Number(servicio.precio),
      gestionTokenHash: gestionTokenHash ?? null,
      cliente: cliente.clienteDeReserva,
    });

    const respuesta = await this.construirRespuesta(
      reserva,
      dto.fecha,
      servicio,
      tokenGestion,
    );

    // Disparo desacoplado de confirmación por WhatsApp en segundo plano
    if (this.whatsappService) {
      this.dispararConfirmacionWhatsApp(dto, cliente.clienteIdConocido, servicio.nombre, respuesta);
    }

    return respuesta;
  }

  /**
   * Envía confirmación por WhatsApp en segundo plano sin bloquear ni afectar la respuesta HTTP.
   */
  private async dispararConfirmacionWhatsApp(
    dto: CrearReservaDto,
    clienteIdConocido: number | null,
    servicioNombre: string,
    respuesta: ReservaCreadaResponseDto,
  ): Promise<void> {
    try {
      let telefono = dto.telefono ?? null;
      let clienteNombre = dto.nombre
        ? `${dto.nombre} ${dto.apellido ?? ''}`.trim()
        : null;

      if (clienteIdConocido) {
        const clienteDb = await this.clientesRepository.obtenerPorId(clienteIdConocido);
        if (clienteDb) {
          if (!telefono && clienteDb.telefono) telefono = clienteDb.telefono;
          if (!clienteNombre) {
            clienteNombre = `${clienteDb.nombre} ${clienteDb.apellido ?? ''}`.trim();
          }
        }
      }

      if (telefono && this.whatsappService) {
        await this.whatsappService.enviarConfirmacionReserva({
          telefono,
          clienteNombre: clienteNombre || 'Cliente',
          servicioNombre,
          barberoNombre: `${respuesta.barbero.nombre} ${respuesta.barbero.apellido}`.trim(),
          fecha: respuesta.fecha,
          hora: respuesta.hora,
          precio: respuesta.servicio.precio,
        });
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo enviar confirmación por WhatsApp: ${err?.message ?? err}`);
    }
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
   * HU-08: Modificar una reserva propia (cliente autenticado).
   * Permite cambiar fecha, hora o barbero de forma atómica y con protección de concurrencia.
   */
  async modificarReserva(
    identidad: IdentidadClienteAutenticado,
    reservaId: number,
    dto: ModificarReservaDto,
  ): Promise<ReservaModificadaResponseDto> {
    this.validarDatosModificacion(dto);

    await this.asegurarClienteVigente(identidad.clienteId);

    const reserva = await this.reservasRepository.obtenerReservaDeCliente(
      identidad.clienteId,
      reservaId,
    );

    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    return this.ejecutarModificacionReserva(reserva, dto, 'autenticado');
  }

  /**
   * HU-08 (Invitados): Modificar una reserva de invitado mediante token de gestión.
   * Valida el token con comparación segura timingSafeEqual y ejecuta la modificación.
   */
  async modificarReservaInvitado(
    reservaId: number,
    tokenGestion: string,
    dto: ModificarReservaDto,
  ): Promise<ReservaModificadaResponseDto> {
    this.validarDatosModificacion(dto);

    const reserva = await this.validarReservaParaGestionInvitado(
      reservaId,
      tokenGestion,
    );

    return this.ejecutarModificacionReserva(reserva, dto, 'invitado');
  }

  /**
   * HU-09: Cancelar una reserva propia (cliente autenticado).
   * Transición confirmada al estado CANCELLED, liberando la franja.
   * Manejo idempotente de peticiones repetidas sin efectos secundarios.
   */
  async cancelarReserva(
    identidad: IdentidadClienteAutenticado,
    reservaId: number,
  ): Promise<ReservaCanceladaResponseDto> {
    await this.asegurarClienteVigente(identidad.clienteId);

    const reserva = await this.reservasRepository.obtenerReservaDeCliente(
      identidad.clienteId,
      reservaId,
    );

    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    return this.ejecutarCancelacionReserva(reserva, 'autenticado');
  }

  /**
   * HU-09 (Invitados): Cancelar una reserva de invitado mediante token de gestión.
   * Valida el token con comparación segura timingSafeEqual y ejecuta la cancelación idempotente.
   */
  async cancelarReservaInvitado(
    reservaId: number,
    tokenGestion: string,
  ): Promise<ReservaCanceladaResponseDto> {
    const reserva = await this.validarReservaParaGestionInvitado(
      reservaId,
      tokenGestion,
    );

    return this.ejecutarCancelacionReserva(reserva, 'invitado');
  }

  /**
   * Lógica de negocio compartida para modificar una reserva (HU-08),
   * invocada tras verificar la autorización (vía JWT de cliente o token de gestión de invitado).
   */
  private async ejecutarModificacionReserva(
    reserva: ReservaConRelaciones,
    dto: ModificarReservaDto,
    modalidad: 'autenticado' | 'invitado',
  ): Promise<ReservaModificadaResponseDto> {
    if (reserva.status === ReservationStatus.CANCELLED) {
      throw new ConflictException('No es posible modificar una reserva cancelada');
    }

    if (
      reserva.status === ReservationStatus.COMPLETED ||
      reserva.status === ReservationStatus.IN_PROGRESS
    ) {
      throw new ConflictException(
        `No es posible modificar una reserva en estado ${reserva.status}`,
      );
    }

    const fechaDestinoStr = dto.fecha ?? this.aFechaCalendario(reserva.date);
    const horaDestino = dto.hora ?? reserva.startTime;
    const barberoDestinoId = dto.barberoId ?? reserva.barberoId;

    const servicio = await this.obtenerServicio(reserva.servicioId);

    const barberoDestino =
      await this.barberosRepository.obtenerBarberoActivoPorId(barberoDestinoId);

    if (!barberoDestino) {
      throw new NotFoundException(
        `El barbero ${barberoDestinoId} no existe o no está activo`,
      );
    }

    const asignado = await this.serviciosRepository.existeAsignacionBarbero(
      barberoDestinoId,
      reserva.servicioId,
    );

    if (!asignado) {
      throw new BadRequestException(
        `El barbero ${barberoDestinoId} no presta el servicio ${reserva.servicioId}`,
      );
    }

    const cambioDeFranja =
      barberoDestinoId !== reserva.barberoId ||
      fechaDestinoStr !== this.aFechaCalendario(reserva.date) ||
      horaDestino !== reserva.startTime;

    if (cambioDeFranja) {
      const duplicada =
        await this.reservasRepository.existeReservaActivaDeClienteEnFranja({
          clienteId: reserva.clienteId,
          barberoId: barberoDestinoId,
          fecha: this.aFechaDate(fechaDestinoStr),
          startTime: horaDestino,
        });

      if (duplicada) {
        throw new ConflictException(MENSAJE_RESERVA_DUPLICADA);
      }
    }

    const franja = await this.obtenerFranjaDisponible(
      barberoDestinoId,
      reserva.servicioId,
      fechaDestinoStr,
      horaDestino,
      reserva.id,
    );

    const precioHistorico =
      reserva.precioReservado !== null
        ? Number(reserva.precioReservado)
        : Number(servicio.precio);

    const reservaActualizada = await this.modificarConManejoDeConflicto({
      id: reserva.id,
      barberoId: barberoDestinoId,
      date: this.aFechaDate(fechaDestinoStr),
      dayOfWeek: this.fechaBogotaService.obtenerDiaSemana(fechaDestinoStr),
      startTime: franja.startTime,
      endTime: franja.endTime,
      precioReservado: precioHistorico,
    });

    this.logger.log(
      `AUDIT: reserva modificada id=${reservaActualizada.id} barberoId=${reservaActualizada.barberoId} fecha=${fechaDestinoStr} hora=${reservaActualizada.startTime} clienteId=${reserva.clienteId} modalidad=${modalidad}`,
    );

    return {
      mensaje: MENSAJE_RESERVA_MODIFICADA,
      id: reservaActualizada.id,
      estado: reservaActualizada.status,
      fecha: fechaDestinoStr,
      hora: reservaActualizada.startTime,
      horaFin: reservaActualizada.endTime,
      precio: precioHistorico,
      barbero: {
        id: reservaActualizada.barbero.id,
        nombre: reservaActualizada.barbero.usuario.nombre,
        apellido: reservaActualizada.barbero.usuario.apellido,
      },
      servicio: {
        id: servicio.id,
        nombre: servicio.nombre,
        precio: Number(servicio.precio),
        duracionMinutos: servicio.duracionMinutos,
      },
    };
  }

  /**
   * Lógica de negocio compartida para cancelar una reserva (HU-09),
   * invocada tras verificar la autorización (vía JWT de cliente o token de gestión de invitado).
   */
  private async ejecutarCancelacionReserva(
    reserva: ReservaConRelaciones,
    modalidad: 'autenticado' | 'invitado',
  ): Promise<ReservaCanceladaResponseDto> {
    if (
      reserva.status === ReservationStatus.COMPLETED ||
      reserva.status === ReservationStatus.IN_PROGRESS
    ) {
      throw new ConflictException(
        `No es posible cancelar una reserva en estado ${reserva.status}`,
      );
    }

    if (reserva.status === ReservationStatus.CANCELLED) {
      return {
        mensaje: MENSAJE_RESERVA_CANCELADA,
        id: reserva.id,
        estado: ReservationStatus.CANCELLED,
      };
    }

    await this.reservasRepository.cancelar(reserva.id);

    this.logger.log(
      `AUDIT: reserva cancelada id=${reserva.id} clienteId=${reserva.clienteId} modalidad=${modalidad}`,
    );

    return {
      mensaje: MENSAJE_RESERVA_CANCELADA,
      id: reserva.id,
      estado: ReservationStatus.CANCELLED,
    };
  }

  /**
   * Valida los campos de modificación para HU-08.
   */
  private validarDatosModificacion(dto: ModificarReservaDto): void {
    if (!dto.fecha && !dto.hora && !dto.barberoId) {
      throw new BadRequestException(
        'Debe proporcionar al menos un campo para modificar la reserva (fecha, hora o barberoId)',
      );
    }

    if (dto.fecha) {
      this.validarFecha(dto.fecha);
    }
  }

  /**
   * Valida que la reserva exista, pertenezca a un invitado (posea hash de gestión)
   * y que el token provisto coincida de forma criptográficamente segura (timingSafeEqual).
   * Para evitar filtración de existencia de reservas (oráculos de inferencia),
   * ante token ausente, reserva inexistente, reserva de cliente autenticado o credencial
   * errónea, responde exactamente la misma excepción: 404 con MENSAJE_RESERVA_NO_DISPONIBLE.
   */
  async validarReservaParaGestionInvitado(
    reservaId: number,
    tokenGestion?: string,
  ): Promise<ReservaConRelaciones> {
    if (
      !tokenGestion ||
      typeof tokenGestion !== 'string' ||
      tokenGestion.trim().length === 0
    ) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    const reserva =
      await this.reservasRepository.obtenerReservaParaGestionInvitado(reservaId);

    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    const tokenValido = this.compararTokenGestion(
      tokenGestion.trim(),
      reserva.gestionTokenHash,
    );

    if (!tokenValido) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    return reserva;
  }

  /** Genera un token criptográficamente seguro de 256 bits en formato hexadecimal (64 caracteres). */
  generarTokenGestion(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /** Genera el hash SHA-256 de un token en formato hexadecimal. */
  hashearToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Compara de forma segura en tiempo constante el hash del token proporcionado con el hash almacenado.
   * Evita ataques de temporización (timing attacks).
   */
  compararTokenGestion(
    tokenProporcionado: string,
    hashAlmacenado: string | null,
  ): boolean {
    if (!hashAlmacenado || !tokenProporcionado) {
      return false;
    }

    const hashCalculado = this.hashearToken(tokenProporcionado);

    const bufferCalculado = Buffer.from(hashCalculado, 'utf8');
    const bufferAlmacenado = Buffer.from(hashAlmacenado, 'utf8');

    if (bufferCalculado.length !== bufferAlmacenado.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufferCalculado, bufferAlmacenado);
  }

  /**
   * Consulta la agenda de reservas del barbero autenticado para una fecha dada.
   *
   * Recupera las citas activas del barbero ordenadas por hora de inicio,
   * incluyendo los datos de contacto del cliente y el servicio asociado.
   * Las reservas canceladas no se incluyen en la agenda activa.
   */
  async obtenerAgendaBarbero(
    usuarioAutenticado: unknown,
    consulta: ConsultaAgendaBarberoDto,
  ): Promise<AgendaBarberoResponseDto> {
    this.validarFecha(consulta.fecha);

    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);

    const fechaDate = this.aFechaDate(consulta.fecha);
    const reservas =
      await this.reservasRepository.listarReservasDeBarberoEnFecha(
        barbero.id,
        fechaDate,
      );

    return {
      fecha: consulta.fecha,
      reservas: reservas.map((r) => this.aCitaAgendaBarbero(r, consulta.fecha)),
    };
  }

  /**
   * Consulta la agenda de reservas del barbero autenticado para un rango de fechas (máximo 7 días).
   *
   * Recupera las citas activas del barbero ordenadas cronológicamente por fecha
   * y hora de inicio, con información de contacto del cliente y detalles del servicio.
   * Las reservas canceladas se excluyen de la agenda activa.
   */
  async obtenerAgendaSemanalBarbero(
    usuarioAutenticado: unknown,
    consulta: ConsultaAgendaSemanalDto,
  ): Promise<AgendaSemanalBarberoResponseDto> {
    this.validarRangoFechas(consulta.desde, consulta.hasta);

    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);

    const desdeDate = this.aFechaDate(consulta.desde);
    const hastaDate = this.aFechaDate(consulta.hasta);

    const reservas =
      await this.reservasRepository.listarReservasDeBarberoEnRango(
        barbero.id,
        desdeDate,
        hastaDate,
      );

    return {
      desde: consulta.desde,
      hasta: consulta.hasta,
      reservas: reservas.map((r) =>
        this.aCitaAgendaBarbero(r, this.aFechaCalendario(r.date)),
      ),
    };
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
    excluirReservaId?: number,
  ): Promise<FranjaEvaluada> {
    const franjas = await this.disponibilidadService.calcularDisponibilidad({
      barberoId,
      servicioId,
      fecha,
      ...(excluirReservaId !== undefined ? { excluirReservaId } : {}),
    });

    const franja = franjas.find((f) => f.startTime === hora);

    if (!franja) {
      throw new BadRequestException(
        `La hora "${hora}" no corresponde a una franja válida de la jornada`,
      );
    }

    if (franja.estado !== EstadoFranja.AVAILABLE) {
      const mensaje =
        excluirReservaId !== undefined
          ? MENSAJE_HORARIO_NO_DISPONIBLE
          : MENSAJE_FRANJA_OCUPADA;
      throw new ConflictException(mensaje);
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

  /**
   * Modifica la reserva traduciendo la violación de unicidad (`P2002`) o conflicto
   * a un 409 con el mensaje de HU-08.
   */
  private async modificarConManejoDeConflicto(
    datos: ModificarReservaDatos,
  ): Promise<ReservaConRelaciones> {
    try {
      return await this.reservasRepository.modificarConBloqueo(datos);
    } catch (error) {
      if (this.esViolacionUnicidad(error)) {
        throw new ConflictException(MENSAJE_HORARIO_NO_DISPONIBLE);
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
    tokenGestion?: string,
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
      ...(tokenGestion ? { tokenGestion } : {}),
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

  /**
   * Valida un rango de fechas de calendario:
   * 1. Ambas deben ser fechas de calendario válidas (formato y existencia en calendario).
   * 2. `desde` no puede ser posterior a `hasta`.
   * 3. El rango total no puede superar los 7 días consecutivos (inclusive).
   */
  private validarRangoFechas(desde: string, hasta: string): void {
    if (!this.fechaBogotaService.esFechaCalendarioValida(desde)) {
      throw new BadRequestException(
        `Fecha inicial ("desde") inválida: "${desde}". Se esperaba una fecha de calendario YYYY-MM-DD`,
      );
    }

    if (!this.fechaBogotaService.esFechaCalendarioValida(hasta)) {
      throw new BadRequestException(
        `Fecha final ("hasta") inválida: "${hasta}". Se esperaba una fecha de calendario YYYY-MM-DD`,
      );
    }

    if (desde > hasta) {
      throw new BadRequestException(
        'La fecha inicial ("desde") no puede ser posterior a la fecha final ("hasta")',
      );
    }

    const fechaDesde = this.aFechaDate(desde);
    const fechaHasta = this.aFechaDate(hasta);
    const diferenciaMs = fechaHasta.getTime() - fechaDesde.getTime();
    const diferenciaDias = Math.round(diferenciaMs / (1000 * 60 * 60 * 24)) + 1;

    if (diferenciaDias > 7) {
      throw new BadRequestException(
        'El rango de consulta no puede superar los 7 días consecutivos',
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

  /**
   * Resuelve el perfil de barbero del usuario autenticado.
   * Lanza 403 si el usuario no tiene perfil de barbero o si se encuentra inactivo.
   */
  private async obtenerBarberoAutenticado(usuarioAutenticado: any) {
    const usuarioId = this.resolverUsuarioId(usuarioAutenticado);
    const barbero =
      await this.barberosRepository.obtenerBarberoPorUsuarioId(usuarioId);

    if (!barbero) {
      throw new ForbiddenException(
        'El usuario autenticado no tiene un perfil de barbero asociado',
      );
    }

    if (barbero.estado !== EstadoUsuario.ACTIVO) {
      throw new ForbiddenException(
        'El perfil de barbero se encuentra inactivo',
      );
    }

    return barbero;
  }

  /**
   * Extrae el `Usuario.id` del payload JWT de personal (`id` numérico o `sub`).
   */
  private resolverUsuarioId(usuarioAutenticado: any): number {
    const idCrudo = usuarioAutenticado?.id ?? usuarioAutenticado?.sub;
    const usuarioId = Number(idCrudo);

    if (
      idCrudo === undefined ||
      idCrudo === null ||
      Number.isNaN(usuarioId) ||
      usuarioId <= 0
    ) {
      throw new UnauthorizedException(
        'No se pudo identificar al usuario autenticado',
      );
    }

    return usuarioId;
  }

  /** Traduce un registro de persistencia al DTO de cita de la agenda del barbero. */
  private aCitaAgendaBarbero(
    reserva: ReservaAgendaRegistro,
    fecha: string,
  ): CitaAgendaBarberoDto {
    return {
      id: reserva.id,
      fecha,
      hora: reserva.startTime,
      horaFin: reserva.endTime,
      estado: reserva.status,
      precio: Number(reserva.precioReservado ?? reserva.servicio.precio),
      cliente: {
        nombre: reserva.cliente.nombre,
        apellido: reserva.cliente.apellido ?? null,
        telefono: reserva.cliente.telefono ?? null,
      },
      servicio: {
        id: reserva.servicio.id,
        nombre: reserva.servicio.nombre,
        duracionMinutos: reserva.servicio.duracionMinutos,
      },
    };
  }
}

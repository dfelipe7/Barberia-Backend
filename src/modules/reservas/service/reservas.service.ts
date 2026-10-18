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
import {
  EstadoUsuario,
  ReservationStatus,
} from '../../../../generated/prisma/enums';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { CrearReservaDto } from '../dto/dto-peticion/crear-reserva.dto';
import { ModificarReservaDto } from '../dto/dto-peticion/modificar-reserva.dto';
import { ConsultaAgendaBarberoDto } from '../dto/dto-peticion/consulta-agenda-barbero.dto';
import { ConsultaAgendaSemanalDto } from '../dto/dto-peticion/consulta-agenda-semanal.dto';
import { ReservaCreadaResponseDto } from '../dto/dto-respuesta/reserva-creada-response.dto';
import { ReservaModificadaResponseDto } from '../dto/dto-respuesta/reserva-modificada-response.dto';
import { ReservaCanceladaResponseDto } from '../dto/dto-respuesta/reserva-cancelada-response.dto';
import { ReservaCompletadaResponseDto } from '../dto/dto-respuesta/reserva-completada-response.dto';
import { ReservaNoShowResponseDto } from '../dto/dto-respuesta/reserva-no-show-response.dto';
import { ReservaClienteDto } from '../dto/dto-respuesta/reserva-cliente.dto';
import { MisReservasResponseDto } from '../dto/dto-respuesta/mis-reservas-response.dto';
import { CrearReservaAdminDto } from '../dto/dto-peticion/crear-reserva-admin.dto';
import { FiltroReservasAdminDto } from '../dto/dto-peticion/filtro-reservas-admin.dto';
import { ReservaAdminDetalleDto } from '../dto/dto-respuesta/reserva-admin-detalle.dto';
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
  ReservaAdminRegistro,
  ReservaAgendaRegistro,
  ReservaCompletarRegistro,
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
import { ConfiguracionService } from '../../configuracion/service/configuracion.service';
import { CLAVES_CONFIGURACION } from '../../configuracion/configuracion.constants';

/** Mensajes de dominio exigidos por los criterios de aceptación (Excel HE-04). */
export const MENSAJE_RESERVA_CREADA = 'Reserva creada exitosamente';
export const MENSAJE_RESERVA_MODIFICADA = 'Reserva modificada correctamente';
export const MENSAJE_RESERVA_CANCELADA = 'Reserva cancelada correctamente';
export const MENSAJE_RESERVA_COMPLETADA = 'Reserva completada correctamente';
export const MENSAJE_RESERVA_NO_SHOW = 'Reserva marcada como no asistida';
export const MENSAJE_FRANJA_OCUPADA =
  'El horario seleccionado ya no está disponible. Por favor selecciona otro horario';
export { MENSAJE_HORARIO_NO_DISPONIBLE };
export const MENSAJE_RESERVA_DUPLICADA =
  'Ya tienes una reserva registrada para este horario';
export const MENSAJE_SIN_RESERVAS = 'No tienes reservas registradas';
export const MENSAJE_RESERVA_NO_DISPONIBLE =
  'La reserva no se encuentra disponible';

/**
 * Reglas de agenda configurables en base de datos (HE-04).
 *
 * Los valores se leen de la tabla `configuraciones_sistema` a través de
 * `ConfiguracionService`. Estas constantes son los valores por defecto que se
 * aplican de forma segura si la configuración falta o es inválida.
 *
 * - `MINUTOS_CANCELACION_ANTELACION_DEFAULT`: antelación mínima con la que un
 *   cliente puede cancelar su reserva en línea. El personal queda exento.
 * - `MINUTOS_NO_SHOW_TOLERANCIA_DEFAULT`: minutos de tolerancia tras la hora de
 *   inicio antes de poder marcar la reserva como `NO_SHOW`.
 */
export const MINUTOS_CANCELACION_ANTELACION_DEFAULT = 120;
export const MINUTOS_NO_SHOW_TOLERANCIA_DEFAULT = 15;

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
    private readonly configuracionService: ConfiguracionService,
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

    // Disparo desacoplado de confirmación por WhatsApp en segundo plano.
    // `dispararConfirmacionWhatsApp` ya gestiona sus propios rechazos con
    // try/catch y logging, por lo que el fire-and-forget se marca con `void`
    // para no propagar un error no controlado ni bloquear la respuesta HTTP.
    if (this.whatsappService) {
      void this.dispararConfirmacionWhatsApp(
        dto,
        cliente.clienteIdConocido,
        servicio.nombre,
        respuesta,
      );
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
        const clienteDb =
          await this.clientesRepository.obtenerPorId(clienteIdConocido);
        if (clienteDb) {
          if (!telefono && clienteDb.telefono) telefono = clienteDb.telefono;
          if (!clienteNombre) {
            clienteNombre =
              `${clienteDb.nombre} ${clienteDb.apellido ?? ''}`.trim();
          }
        }
      }

      if (telefono && this.whatsappService) {
        await this.whatsappService.enviarConfirmacionReserva({
          telefono,
          clienteNombre: clienteNombre || 'Cliente',
          servicioNombre,
          barberoNombre:
            `${respuesta.barbero.nombre} ${respuesta.barbero.apellido}`.trim(),
          fecha: respuesta.fecha,
          hora: respuesta.hora,
          precio: respuesta.servicio.precio,
        });
      }
    } catch (err: any) {
      this.logger.warn(
        `No se pudo enviar confirmación por WhatsApp: ${err?.message ?? err}`,
      );
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
   * HU-13: Creación administrativa de reserva para ADMINISTRADOR o SUPERADMIN.
   * Permite agendar para un cliente registrado existente o dar de alta un cliente
   * ocasional dentro de la misma transacción atómica.
   */
  async crearReservaAdmin(
    dto: CrearReservaAdminDto,
  ): Promise<ReservaCreadaResponseDto> {
    this.validarFecha(dto.fecha);

    let clienteDeReserva: ClienteDeReserva;
    let tokenGestion: string | undefined = undefined;
    let gestionTokenHash: string | null = null;
    let clienteNombreNotif = 'Cliente';
    let clienteTelefonoNotif: string | null = null;

    if (dto.clienteId !== undefined && dto.clienteId !== null) {
      const clienteDb = await this.clientesRepository.obtenerPorId(
        dto.clienteId,
      );
      if (!clienteDb) {
        throw new NotFoundException(
          `El cliente con ID ${dto.clienteId} no existe`,
        );
      }
      clienteDeReserva = { clienteId: clienteDb.id };
      clienteNombreNotif =
        `${clienteDb.nombre} ${clienteDb.apellido ?? ''}`.trim();
      clienteTelefonoNotif = dto.telefono ?? clienteDb.telefono ?? null;

      // CA-04: el mismo cliente no puede duplicar la reserva de la franja.
      const duplicada =
        await this.reservasRepository.existeReservaActivaDeClienteEnFranja({
          clienteId: clienteDb.id,
          barberoId: dto.barberoId,
          fecha: this.aFechaDate(dto.fecha),
          startTime: dto.hora,
        });

      if (duplicada) {
        throw new ConflictException(MENSAJE_RESERVA_DUPLICADA);
      }
    } else {
      // Cliente ocasional sin cuenta (HU-13-CA-03, CA-04)
      const nombreLimpio = dto.nombre?.trim();
      const telefonoLimpio = dto.telefono?.trim();

      if (!nombreLimpio || !telefonoLimpio) {
        throw new BadRequestException(
          'Para un cliente ocasional, el nombre y el teléfono son obligatorios',
        );
      }

      tokenGestion = this.generarTokenGestion();
      gestionTokenHash = this.hashearToken(tokenGestion);

      clienteDeReserva = {
        crear: {
          nombre: nombreLimpio,
          apellido: dto.apellido?.trim() ?? null,
          telefono: telefonoLimpio,
          email: dto.email?.trim() ?? null,
          usuarioId: null,
        },
      };
      clienteNombreNotif =
        `${nombreLimpio} ${dto.apellido?.trim() ?? ''}`.trim();
      clienteTelefonoNotif = telefonoLimpio;
    }

    const servicio = await this.obtenerServicio(dto.servicioId);

    const barbero = await this.barberosRepository.obtenerBarberoActivoPorId(
      dto.barberoId,
    );
    if (!barbero) {
      throw new NotFoundException(
        `El barbero ${dto.barberoId} no existe o no está activo`,
      );
    }

    const asignado = await this.serviciosRepository.existeAsignacionBarbero(
      dto.barberoId,
      dto.servicioId,
    );
    if (!asignado) {
      throw new BadRequestException(
        `El barbero ${dto.barberoId} no presta el servicio ${dto.servicioId}`,
      );
    }

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
      dayOfWeek: this.fechaBogotaService.obtenerDiaSemana(dto.fecha),
      startTime: franja.startTime,
      endTime: franja.endTime,
      status: ReservationStatus.CONFIRMED,
      precioReservado: Number(servicio.precio),
      gestionTokenHash,
      cliente: clienteDeReserva,
    });

    this.logger.log(
      `AUDIT: reserva administrativa creada id=${reserva.id} barberoId=${reserva.barberoId} servicioId=${reserva.servicioId} clienteId=${reserva.clienteId}`,
    );

    const respuesta = await this.construirRespuesta(
      reserva,
      dto.fecha,
      servicio,
      tokenGestion,
    );

    // Disparo desacoplado de confirmación por WhatsApp en segundo plano
    if (this.whatsappService && clienteTelefonoNotif) {
      this.whatsappService
        .enviarConfirmacionReserva({
          telefono: clienteTelefonoNotif,
          clienteNombre: clienteNombreNotif,
          servicioNombre: servicio.nombre,
          barberoNombre:
            `${respuesta.barbero.nombre} ${respuesta.barbero.apellido}`.trim(),
          fecha: respuesta.fecha,
          hora: respuesta.hora,
          precio: respuesta.servicio.precio,
        })
        .catch((err) =>
          this.logger.warn(
            `No se pudo enviar confirmación por WhatsApp en admin: ${err?.message ?? err}`,
          ),
        );
    }

    return respuesta;
  }

  /**
   * SUPERADMIN: Listar reservas de la barbería aplicando filtros en base de datos.
   */
  async listarReservasAdmin(
    filtro: FiltroReservasAdminDto,
  ): Promise<ReservaAdminDetalleDto[]> {
    let fechaDate: Date | undefined = undefined;
    let desdeDate: Date | undefined = undefined;
    let hastaDate: Date | undefined = undefined;

    if (filtro.fecha) {
      this.validarFecha(filtro.fecha);
      fechaDate = this.aFechaDate(filtro.fecha);
    }

    if (filtro.desde) {
      this.validarFecha(filtro.desde);
      desdeDate = this.aFechaDate(filtro.desde);
    }

    if (filtro.hasta) {
      this.validarFecha(filtro.hasta);
      hastaDate = this.aFechaDate(filtro.hasta);
    }

    if (filtro.desde && filtro.hasta && filtro.desde > filtro.hasta) {
      throw new BadRequestException(
        'El rango de fechas es inválido: "desde" debe ser menor o igual a "hasta"',
      );
    }

    const registros = await this.reservasRepository.listarReservasAdmin({
      fecha: fechaDate,
      desde: desdeDate,
      hasta: hastaDate,
      barberoId: filtro.barberoId,
      estado: filtro.estado,
      clienteId: filtro.clienteId,
    });

    return registros.map((r) => this.mapearReservaAdmin(r));
  }

  /**
   * SUPERADMIN: Consulta el detalle completo de cualquier reserva de la barbería.
   */
  async obtenerReservaAdmin(
    reservaId: number,
  ): Promise<ReservaAdminDetalleDto> {
    const reserva =
      await this.reservasRepository.obtenerReservaAdminPorId(reservaId);
    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }
    return this.mapearReservaAdmin(reserva);
  }

  /**
   * SUPERADMIN: Modifica una reserva de cualquier barbero respetando las reglas de disponibilidad.
   */
  async modificarReservaAdmin(
    reservaId: number,
    dto: ModificarReservaDto,
  ): Promise<ReservaModificadaResponseDto> {
    this.validarDatosModificacion(dto);

    const reserva =
      await this.reservasRepository.obtenerReservaConRelaciones(reservaId);
    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    return this.ejecutarModificacionReserva(reserva, dto, 'admin');
  }

  /**
   * SUPERADMIN: Cancela una reserva de cualquier barbero.
   */
  async cancelarReservaAdmin(
    reservaId: number,
  ): Promise<ReservaCanceladaResponseDto> {
    const reserva =
      await this.reservasRepository.obtenerReservaConRelaciones(reservaId);
    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    return this.ejecutarCancelacionReserva(reserva, 'admin');
  }

  /**
   * SCRUM-277: Marca una reserva como COMPLETED.
   *
   * Permitido a BARBERO (solo su propia reserva), ADMINISTRADOR y SUPERADMIN.
   * Solo se puede completar cuando ya pasó la hora de finalización de la cita;
   * es idempotente si la reserva ya está COMPLETED y rechaza reservas CANCELLED.
   * Al concretarse la transición, notifica al cliente por WhatsApp de forma
   * desacoplada (best-effort, no afecta la respuesta HTTP).
   */
  async completarReserva(
    usuarioAutenticado: unknown,
    rol: string | undefined,
    reservaId: number,
  ): Promise<ReservaCompletadaResponseDto> {
    const reserva =
      await this.reservasRepository.obtenerReservaParaCompletar(reservaId);

    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    // Anti-BOLA/IDOR: un BARBERO solo puede completar sus propias reservas. Se
    // responde 404 uniforme para no revelar la existencia de reservas ajenas.
    if (rol === 'BARBERO') {
      const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);

      if (reserva.barberoId !== barbero.id) {
        throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
      }
    }

    if (reserva.status === ReservationStatus.CANCELLED) {
      throw new ConflictException(
        'No es posible completar una reserva cancelada',
      );
    }

    // Idempotencia: repetir la petición no duplica efectos ni notificaciones.
    if (reserva.status === ReservationStatus.COMPLETED) {
      return {
        mensaje: MENSAJE_RESERVA_COMPLETADA,
        id: reserva.id,
        estado: ReservationStatus.COMPLETED,
      };
    }

    this.validarHoraDeFinalizacion(reserva);

    const transiciono = await this.reservasRepository.completar(reserva.id);

    if (transiciono) {
      this.logger.log(
        `AUDIT: reserva completada id=${reserva.id} barberoId=${reserva.barberoId} rol=${rol ?? 'desconocido'}`,
      );
      this.dispararCompletadoWhatsApp(reserva);
    }

    return {
      mensaje: MENSAJE_RESERVA_COMPLETADA,
      id: reserva.id,
      estado: ReservationStatus.COMPLETED,
    };
  }

  /**
   * Marca una reserva como `NO_SHOW` (el cliente no asistió).
   *
   * Permitido a BARBERO (solo su propia reserva), ADMINISTRADOR y SUPERADMIN.
   * Solo se puede marcar una vez transcurrida la tolerancia configurada desde la
   * hora de inicio; es idempotente si ya está en `NO_SHOW` y rechaza reservas
   * canceladas o completadas. `NO_SHOW` ocupa la franja, igual que `COMPLETED`.
   */
  async noShowReserva(
    usuarioAutenticado: unknown,
    rol: string | undefined,
    reservaId: number,
  ): Promise<ReservaNoShowResponseDto> {
    const reserva =
      await this.reservasRepository.obtenerReservaParaNoShow(reservaId);

    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    // Anti-BOLA/IDOR: un BARBERO solo puede marcar sus propias reservas. Se
    // responde 404 uniforme para no revelar la existencia de reservas ajenas.
    if (rol === 'BARBERO') {
      const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);

      if (reserva.barberoId !== barbero.id) {
        throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
      }
    }

    if (reserva.status === ReservationStatus.CANCELLED) {
      throw new ConflictException(
        'No es posible marcar como no asistida una reserva cancelada',
      );
    }

    if (reserva.status === ReservationStatus.COMPLETED) {
      throw new ConflictException(
        'No es posible marcar como no asistida una reserva completada',
      );
    }

    // Idempotencia: repetir la petición no duplica efectos.
    if (reserva.status === ReservationStatus.NO_SHOW) {
      return {
        mensaje: MENSAJE_RESERVA_NO_SHOW,
        id: reserva.id,
        estado: ReservationStatus.NO_SHOW,
      };
    }

    await this.validarToleranciaNoShow(reserva);

    const transiciono = await this.reservasRepository.marcarNoShow(reserva.id);

    if (transiciono) {
      this.logger.log(
        `AUDIT: reserva marcada como no asistida id=${reserva.id} barberoId=${reserva.barberoId} rol=${rol ?? 'desconocido'}`,
      );
    }

    return {
      mensaje: MENSAJE_RESERVA_NO_SHOW,
      id: reserva.id,
      estado: ReservationStatus.NO_SHOW,
    };
  }

  /**
   * Exige que haya transcurrido la tolerancia configurada desde la hora de
   * inicio (en Bogotá) para poder marcar la reserva como `NO_SHOW`.
   */
  private async validarToleranciaNoShow(
    reserva: ReservaCompletarRegistro,
  ): Promise<void> {
    const tolerancia = await this.obtenerMinutosToleranciaNoShow();

    if (this.minutosHastaInicioEnBogota(reserva) > -tolerancia) {
      throw new ConflictException(
        `No es posible marcar la reserva como no asistida antes de ${tolerancia} minutos desde su hora de inicio`,
      );
    }
  }

  /**
   * Minutos (con signo) que faltan para la hora de inicio de la reserva, en la
   * zona horaria de Bogotá. Positivo si la cita es futura, negativo si su inicio
   * ya pasó. Tanto la reserva como el instante actual se expresan como fecha de
   * calendario + hora Bogotá, de modo que la diferencia es real (Bogotá no tiene
   * horario de verano: el desplazamiento UTC-5 se cancela).
   */
  private minutosHastaInicioEnBogota(
    reserva: { date: Date; startTime: string },
    ahora: Date = new Date(),
  ): number {
    const ahoraMs = this.aInstanteCalendarioMs(
      this.fechaBogotaService.obtenerFechaBogota(ahora),
      this.fechaBogotaService.obtenerHoraBogota(ahora),
    );
    const inicioMs = this.aInstanteCalendarioMs(
      this.aFechaCalendario(reserva.date),
      reserva.startTime,
    );

    return Math.round((inicioMs - ahoraMs) / 60_000);
  }

  /**
   * Convierte una fecha de calendario (`YYYY-MM-DD`) y una hora (`HH:mm`) en
   * milisegundos UTC. Es una escala neutra común para comparar horas de Bogotá.
   */
  private aInstanteCalendarioMs(fecha: string, hora: string): number {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const [horas, minutos] = hora.split(':').map(Number);

    return Date.UTC(anio, mes - 1, dia, horas, minutos);
  }

  /**
   * Minutos de antelación mínima para cancelar en línea. Se leen de la
   * configuración en base de datos vía `ConfiguracionService`; si faltan o son
   * inválidos, se aplica el valor por defecto.
   */
  private async obtenerMinutosCancelacion(): Promise<number> {
    const valor = await this.configuracionService.obtenerNumero(
      CLAVES_CONFIGURACION.RESERVA_CANCELACION_ANTELACION_MINUTOS,
      MINUTOS_CANCELACION_ANTELACION_DEFAULT,
    );

    return this.normalizarMinutos(
      valor,
      MINUTOS_CANCELACION_ANTELACION_DEFAULT,
    );
  }

  /**
   * Minutos de tolerancia antes de poder marcar `NO_SHOW`. Se leen de la
   * configuración en base de datos vía `ConfiguracionService`; si faltan o son
   * inválidos, se aplica el valor por defecto.
   */
  private async obtenerMinutosToleranciaNoShow(): Promise<number> {
    const valor = await this.configuracionService.obtenerNumero(
      CLAVES_CONFIGURACION.RESERVA_NO_SHOW_TOLERANCIA_MINUTOS,
      MINUTOS_NO_SHOW_TOLERANCIA_DEFAULT,
    );

    return this.normalizarMinutos(valor, MINUTOS_NO_SHOW_TOLERANCIA_DEFAULT);
  }

  /**
   * Normaliza los minutos configurados: exige un entero positivo y, en caso
   * contrario, aplica el valor por defecto. Conserva el comportamiento previo
   * (no se aceptan 0 ni valores negativos).
   */
  private normalizarMinutos(valor: number, porDefecto: number): number {
    return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : porDefecto;
  }

  /**
   * Exige que la hora de finalización de la reserva ya haya pasado (en Bogotá)
   * para poder marcarla como completada.
   */
  private validarHoraDeFinalizacion(reserva: ReservaCompletarRegistro): void {
    const ahora = new Date();
    const claveAhora = `${this.fechaBogotaService.obtenerFechaBogota(ahora)}T${this.fechaBogotaService.obtenerHoraBogota(ahora)}`;
    const claveFin = `${this.aFechaCalendario(reserva.date)}T${reserva.endTime}`;

    if (claveAhora < claveFin) {
      throw new ConflictException(
        'No es posible completar una reserva antes de su hora de finalización',
      );
    }
  }

  /**
   * Notifica al cliente, en segundo plano, que su cita fue completada.
   */
  private dispararCompletadoWhatsApp(reserva: ReservaCompletarRegistro): void {
    if (!this.whatsappService || !reserva.cliente.telefono) {
      return;
    }

    const clienteNombre =
      `${reserva.cliente.nombre} ${reserva.cliente.apellido ?? ''}`.trim() ||
      'Cliente';

    this.whatsappService
      .enviarCompletadoReserva({
        telefono: reserva.cliente.telefono,
        clienteNombre,
        servicioNombre: reserva.servicio.nombre,
        barberoNombre:
          `${reserva.barbero.usuario.nombre} ${reserva.barbero.usuario.apellido}`.trim(),
        fecha: this.aFechaCalendario(reserva.date),
        hora: reserva.startTime,
        precio:
          reserva.precioReservado !== null
            ? Number(reserva.precioReservado)
            : null,
      })
      .catch((err) =>
        this.logger.warn(
          `No se pudo enviar notificación de completado por WhatsApp: ${err?.message ?? err}`,
        ),
      );
  }

  /**
   * Búsqueda de clientes para selección administrativa (HU-13-CA-02).
   */
  async buscarClientesAdmin(termino: string) {
    return this.clientesRepository.buscarClientes(termino);
  }

  /**
   * Mapea el registro de persistencia a la respuesta detallada de administración.
   */
  private mapearReservaAdmin(r: ReservaAdminRegistro): ReservaAdminDetalleDto {
    const esRegistrado = Boolean(r.cliente.usuarioId || r.cliente.googleId);
    const precio =
      r.precioReservado !== null
        ? Number(r.precioReservado)
        : Number(r.servicio.precio);

    return {
      id: r.id,
      fecha: this.aFechaCalendario(r.date),
      hora: r.startTime,
      horaFin: r.endTime,
      estado: r.status,
      precio,
      createdAt: r.createdAt,
      barbero: {
        id: r.barbero.id,
        nombre: r.barbero.usuario.nombre,
        apellido: r.barbero.usuario.apellido,
      },
      cliente: {
        id: r.cliente.id,
        nombre: r.cliente.nombre,
        apellido: r.cliente.apellido,
        telefono: r.cliente.telefono,
        email: r.cliente.email,
        esRegistrado,
      },
      servicio: {
        id: r.servicio.id,
        nombre: r.servicio.nombre,
        precio: Number(r.servicio.precio),
        duracionMinutos: r.servicio.duracionMinutos,
      },
    };
  }

  /**
   * Lógica de negocio compartida para modificar una reserva (HU-08),
   * invocada tras verificar la autorización (vía JWT de cliente, token de gestión de invitado o admin).
   */
  private async ejecutarModificacionReserva(
    reserva: ReservaConRelaciones,
    dto: ModificarReservaDto,
    modalidad: 'autenticado' | 'invitado' | 'admin',
  ): Promise<ReservaModificadaResponseDto> {
    if (reserva.status === ReservationStatus.CANCELLED) {
      throw new ConflictException(
        'No es posible modificar una reserva cancelada',
      );
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
    modalidad: 'autenticado' | 'invitado' | 'admin',
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

    // D-10: el cliente solo puede cancelar con una antelación mínima. Dentro de
    // la ventana debe contactar a la barbería; el personal (admin) queda exento.
    if (modalidad !== 'admin') {
      const antelacion = await this.obtenerMinutosCancelacion();
      if (this.minutosHastaInicioEnBogota(reserva) < antelacion) {
        throw new ConflictException(
          `No es posible cancelar la reserva: faltan menos de ${antelacion} minutos para la cita. Contacta directamente a la barbería.`,
        );
      }
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
      await this.reservasRepository.obtenerReservaParaGestionInvitado(
        reservaId,
      );

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

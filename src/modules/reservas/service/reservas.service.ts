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
  ESTADOS_QUE_OCUPAN_AGENDA,
  MENSAJE_HORARIO_NO_DISPONIBLE,
  FirmaIntentoReserva,
  mismaFirmaReserva,
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
import {
  estaCubiertaPorBloqueo,
  estaCubiertaPorCierreGeneral,
  estaFueraDelHorarioSemanal,
  solapaConReserva,
} from '../../horarios/strategies/reglas-disponibilidad-puras';
import {
  CODIGOS_CONFLICTO,
  DomainConflictException,
} from '../../../common/exceptions/domain-conflict.exception';
import { Prisma } from '../../../../generated/prisma/client';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';
import { ConfiguracionService } from '../../configuracion/service/configuracion.service';
import {
  CLAVES_CONFIGURACION,
  LIMITES_MINUTOS_OPERATIVOS,
  VALORES_POR_DEFECTO_OPERATIVOS,
} from '../../configuracion/configuracion.constants';
import { obtenerContextoNegocio } from '../../negocios/negocio-almacenamiento';

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
 * Los valores se leen, en el ámbito del NEGOCIO activo, a través de
 * `ConfiguracionService` (tabla `configuraciones_negocio`). Estas constantes
 * son los valores por defecto que se aplican de forma segura si la
 * configuración falta o es inválida, y son la MISMA fuente que usa el servicio
 * de configuración.
 *
 * - `MINUTOS_CANCELACION_ANTELACION_DEFAULT`: antelación mínima con la que un
 *   cliente puede cancelar su reserva en línea. El personal queda exento.
 * - `MINUTOS_NO_SHOW_TOLERANCIA_DEFAULT`: minutos de tolerancia tras la hora de
 *   inicio antes de poder marcar la reserva como `NO_SHOW`.
 */
export const MINUTOS_CANCELACION_ANTELACION_DEFAULT =
  VALORES_POR_DEFECTO_OPERATIVOS.RESERVA_CANCELACION_ANTELACION_MINUTOS;
export const MINUTOS_NO_SHOW_TOLERANCIA_DEFAULT =
  VALORES_POR_DEFECTO_OPERATIVOS.RESERVA_NO_SHOW_TOLERANCIA_MINUTOS;

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
   * Crea y confirma una nueva cita de forma atómica en el sistema de reservas.
   *
   * @remarks
   * Reglas de Negocio Críticas (Integridad Financiera y Concurrencia):
   * 1. Precio Inmutable en Servidor: El precio (`precioReservado`) se resuelve del catálogo vigente.
   *    Jamás se confía en valores monetarios enviados desde el cliente para prevenir fraude.
   * 2. Token de Gestión para Invitados: Genera un token criptográfico cifrado (AES-256-GCM) y hasheado
   *    (SHA-256), permitiendo que el invitado gestione su cita sin contraseñas.
   * 3. Idempotencia Segura: Con cabecera `Idempotency-Key`, reintentos de red recuperan la reserva previa.
   * 4. Notificación Asíncrona: Dispara la confirmación por WhatsApp en segundo plano sin bloquear el HTTP.
   *
   * @param dto - Datos validados de la cita (servicio, barbero, fecha y hora de inicio)
   * @param identidad - Claims del cliente autenticado, o undefined si opera como invitado
   * @param idempotencyKey - Identificador único de transacción para prevenir cobros duplicados
   * @returns Comprobante de reserva creada con código, franja horaria y token de gestión
   * @throws {BadRequestException} Si la fecha es inválida o no cumple con el formato
   * @throws {DomainConflictException} Si la franja horaria ya fue tomada o está duplicada
   *
   * @param dto datos obligatorios + contacto del invitado (si aplica).
   * @param identidad cliente autenticado (Modalidad B) o `undefined` (invitado).
   * @param idempotencyKey clave de idempotencia del intento (cabecera
   *   `Idempotency-Key`). Si se repite el MISMO intento con la misma clave, se
   *   recupera la reserva original en lugar de crear otra.
   */
  async crearReserva(
    dto: CrearReservaDto,
    identidad?: IdentidadClienteAutenticado,
    idempotencyKey?: string,
  ): Promise<ReservaCreadaResponseDto> {
    this.validarFecha(dto.fecha);

    const cliente = await this.resolverCliente(dto, identidad);

    // IDEMPOTENCIA (antes que el duplicado del propio cliente): un reintento
    // con la misma clave debe recuperar la reserva original, no rebotar con un
    // conflicto de duplicado.
    if (idempotencyKey) {
      const previa =
        await this.reservasRepository.obtenerPorClaveDeIdempotencia(
          idempotencyKey,
        );

      if (previa) {
        return this.responderReplay(previa, dto, cliente);
      }
    }

    // CA-04: el mismo cliente no puede duplicar la reserva de la franja.
    //
    // La reserva que lleva la MISMA clave de idempotencia es este mismo
    // intento: no cuenta como duplicado (si lo contara, un reintento
    // concurrente se rechazaría en lugar de recuperar la reserva original).
    if (cliente.clienteIdConocido !== null) {
      const duplicada =
        await this.reservasRepository.existeReservaActivaDeClienteEnFranja({
          clienteId: cliente.clienteIdConocido,
          barberoId: dto.barberoId,
          fecha: this.aFechaDate(dto.fecha),
          startTime: dto.hora,
          ...(idempotencyKey !== undefined
            ? { excluirIdempotencyKey: idempotencyKey }
            : {}),
        });

      if (duplicada) {
        throw new DomainConflictException(
          MENSAJE_RESERVA_DUPLICADA,
          CODIGOS_CONFLICTO.DUPLICATE_OWN_RESERVATION,
        );
      }
    }

    // Fuente única de verdad (HE-08): valida servicio/barbero/asignación/fecha y
    // devuelve el estado real de cada franja.
    let franja: FranjaEvaluada;

    try {
      franja = await this.obtenerFranjaDisponible(
        dto.barberoId,
        dto.servicioId,
        dto.fecha,
        dto.hora,
      );
    } catch (error) {
      // Si el intento lleva clave de idempotencia, la franja puede haberla
      // ocupado NUESTRO propio intento concurrente: en ese caso se recupera esa
      // reserva en lugar de rechazar con un conflicto de franja.
      if (idempotencyKey && this.esConflictoDeFranja(error)) {
        const original =
          await this.reservasRepository.obtenerPorClaveDeIdempotencia(
            idempotencyKey,
          );
        if (original) {
          return this.responderReplay(original, dto, cliente);
        }
      }

      throw error;
    }

    const servicio = await this.obtenerServicio(dto.servicioId);

    let tokenGestion: string | undefined;
    let gestionTokenHash: string | undefined;
    let gestionTokenCifrado: string | undefined;

    if (!identidad) {
      tokenGestion = this.generarTokenGestion();
      gestionTokenHash = this.hashearToken(tokenGestion);
      gestionTokenCifrado = this.cifrarTokenGestion(tokenGestion);
    }

    const datos = {
      barberoId: dto.barberoId,
      servicioId: dto.servicioId,
      date: this.aFechaDate(dto.fecha),
      dayOfWeek: this.fechaBogotaService.obtenerDiaSemana(dto.fecha),
      startTime: franja.startTime,
      endTime: franja.endTime,
      // Precio histórico calculado en el servidor, no confiado al cliente.
      precioReservado: Number(servicio.precio),
      gestionTokenHash: gestionTokenHash ?? null,
      gestionTokenCifrado: gestionTokenCifrado ?? null,
      idempotencyKey: idempotencyKey ?? null,
      cliente: cliente.clienteDeReserva,
    };

    const reserva = await this.crearConManejoDeConflicto(datos);

    // El token de la respuesta es SIEMPRE el PERSISTIDO: si la creación
    // resultó ser un reintento (y la reserva la creó otra petición), se
    // devuelve el token ORIGINAL descifrado, nunca uno local que no se
    // guardó en ninguna parte.
    const respuesta = await this.construirRespuesta(
      reserva,
      dto.fecha,
      servicio,
      this.descifrarTokenGestion(reserva.gestionTokenCifrado) ?? undefined,
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
        let enlaceGestion: string | null = null;
        if (respuesta.tokenGestion) {
          const frontendUrl =
            process.env.FRONTEND_URL || 'http://localhost:5173';
          const contexto = obtenerContextoNegocio();
          const slug = contexto?.slug || 'kyrios-studio';
          enlaceGestion = `${frontendUrl}/${slug}/c/${respuesta.id}/${respuesta.tokenGestion}`;
        }

        await this.whatsappService.enviarConfirmacionReserva({
          telefono,
          clienteNombre: clienteNombre || 'Cliente',
          servicioNombre,
          barberoNombre:
            `${respuesta.barbero.nombre} ${respuesta.barbero.apellido}`.trim(),
          fecha: respuesta.fecha,
          hora: respuesta.hora,
          precio: respuesta.servicio.precio,
          enlaceGestion,
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
   * Cancela una reserva efectuada por un cliente invitado utilizando su token criptográfico de gestión.
   *
   * @remarks
   * Seguridad Defensiva (Timing Attacks):
   * Valida la autenticidad del token mediante `crypto.timingSafeEqual` sobre buffers constantes,
   * impidiendo que atacantes deduzcan tokens válidos mediante análisis de latencia de red.
   * La cancelación es atómica e idempotente: actualiza el estado a CANCELLED y libera la franja horaria.
   *
   * @param reservaId - Identificador numérico de la reserva a cancelar
   * @param tokenGestion - Token secreto de gestión emitido al momento de agendar
   * @returns Comprobante de confirmación de cancelación con fecha de liberación de la franja
   * @throws {NotFoundException} Si la reserva no existe, el token es inválido o la cita ya fue completada
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
   * Consulta el detalle de una reserva de invitado mediante su token de gestión.
   */
  async obtenerReservaInvitado(
    reservaId: number,
    tokenGestion: string,
  ): Promise<
    ReservaClienteDto & {
      cliente?: {
        nombre: string;
        apellido: string | null;
        telefono: string | null;
      };
    }
  > {
    const reserva = await this.validarReservaParaGestionInvitado(
      reservaId,
      tokenGestion,
    );

    const dto = this.aReservaCliente(reserva);
    const cliente = (reserva as any).cliente;

    return {
      ...dto,
      cliente: cliente
        ? {
            nombre: cliente.nombre,
            apellido: cliente.apellido ?? null,
            telefono: cliente.telefono ?? null,
          }
        : undefined,
    };
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
    let gestionTokenCifrado: string | null = null;
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
      gestionTokenCifrado = this.cifrarTokenGestion(tokenGestion);

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
      gestionTokenCifrado,
      cliente: clienteDeReserva,
    });

    this.logger.log(
      `AUDIT: reserva administrativa creada id=${reserva.id} barberoId=${reserva.barberoId} servicioId=${reserva.servicioId} clienteId=${reserva.clienteId}`,
    );

    const respuesta = await this.construirRespuesta(
      reserva,
      dto.fecha,
      servicio,
      this.descifrarTokenGestion(reserva.gestionTokenCifrado) ?? undefined,
    );

    // Disparo desacoplado de confirmación por WhatsApp en segundo plano
    if (this.whatsappService && clienteTelefonoNotif) {
      let enlaceGestionAdmin: string | null = null;
      if (respuesta.tokenGestion) {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const contexto = obtenerContextoNegocio();
        const slug = contexto?.slug || 'kyrios-studio';
        enlaceGestionAdmin = `${frontendUrl}/${slug}/c/${respuesta.id}/${respuesta.tokenGestion}`;
      }

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
          enlaceGestion: enlaceGestionAdmin,
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
    roles: string[] | undefined,
    reservaId: number,
  ): Promise<ReservaCompletadaResponseDto> {
    const reserva =
      await this.reservasRepository.obtenerReservaParaCompletar(reservaId);

    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    // Anti-BOLA/IDOR: un BARBERO solo puede completar sus propias reservas. Se
    // responde 404 uniforme para no revelar la existencia de reservas ajenas.
    if (roles?.includes('BARBERO')) {
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
        `AUDIT: reserva completada id=${reserva.id} barberoId=${reserva.barberoId} roles=${roles?.join(',') ?? 'desconocido'}`,
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
    roles: string[] | undefined,
    reservaId: number,
  ): Promise<ReservaNoShowResponseDto> {
    const reserva =
      await this.reservasRepository.obtenerReservaParaNoShow(reservaId);

    if (!reserva) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    // Anti-BOLA/IDOR: un BARBERO solo puede marcar sus propias reservas. Se
    // responde 404 uniforme para no revelar la existencia de reservas ajenas.
    if (roles?.includes('BARBERO')) {
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
        `AUDIT: reserva marcada como no asistida id=${reserva.id} barberoId=${reserva.barberoId} roles=${roles?.join(',') ?? 'desconocido'}`,
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
   * configuración del NEGOCIO activo vía `ConfiguracionService`; si faltan o
   * son inválidos, el servicio de configuración aplica el valor por defecto.
   */
  private async obtenerMinutosCancelacion(): Promise<number> {
    return this.configuracionService.obtenerNumero(
      CLAVES_CONFIGURACION.RESERVA_CANCELACION_ANTELACION_MINUTOS,
      MINUTOS_CANCELACION_ANTELACION_DEFAULT,
      LIMITES_MINUTOS_OPERATIVOS,
    );
  }

  /**
   * Minutos de tolerancia antes de poder marcar `NO_SHOW`. Se leen de la
   * configuración del NEGOCIO activo vía `ConfiguracionService`; si faltan o
   * son inválidos, el servicio de configuración aplica el valor por defecto.
   */
  private async obtenerMinutosToleranciaNoShow(): Promise<number> {
    return this.configuracionService.obtenerNumero(
      CLAVES_CONFIGURACION.RESERVA_NO_SHOW_TOLERANCIA_MINUTOS,
      MINUTOS_NO_SHOW_TOLERANCIA_DEFAULT,
      LIMITES_MINUTOS_OPERATIVOS,
    );
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

    if (this.whatsappService) {
      void (async () => {
        try {
          const cliente = await this.clientesRepository.obtenerPorId(
            reserva.clienteId,
          );
          if (cliente?.telefono) {
            let enlaceGestion: string | null = null;
            const tokenDescifrado = this.descifrarTokenGestion(
              reserva.gestionTokenCifrado,
            );
            if (tokenDescifrado) {
              const slug = obtenerContextoNegocio()?.slug || 'kyrios-studio';
              const frontendUrl =
                process.env.FRONTEND_URL || 'http://localhost:5173';
              enlaceGestion = `${frontendUrl}/${slug}/c/${reservaActualizada.id}/${tokenDescifrado}`;
            }

            await this.whatsappService?.enviarReprogramacionReserva({
              telefono: cliente.telefono,
              clienteNombre:
                `${cliente.nombre} ${cliente.apellido ?? ''}`.trim() ||
                'Cliente',
              servicioNombre: servicio.nombre,
              barberoNombre:
                `${reservaActualizada.barbero.usuario.nombre} ${reservaActualizada.barbero.usuario.apellido}`.trim(),
              fecha: fechaDestinoStr,
              hora: reservaActualizada.startTime,
              precio: precioHistorico,
              enlaceGestion,
            });
          }
        } catch (err: any) {
          this.logger.warn(
            `No se pudo enviar WhatsApp de reprogramación: ${err?.message ?? err}`,
          );
        }
      })();
    }

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

    if (this.whatsappService) {
      void (async () => {
        try {
          const cliente = await this.clientesRepository.obtenerPorId(
            reserva.clienteId,
          );
          if (cliente?.telefono) {
            await this.whatsappService?.enviarCancelacionReserva({
              telefono: cliente.telefono,
              clienteNombre:
                `${cliente.nombre} ${cliente.apellido ?? ''}`.trim() ||
                'Cliente',
              servicioNombre: reserva.servicio.nombre,
              barberoNombre:
                `${reserva.barbero.usuario.nombre} ${reserva.barbero.usuario.apellido}`.trim(),
              fecha: this.aFechaCalendario(reserva.date),
              hora: reserva.startTime,
            });
          }
        } catch (err: any) {
          this.logger.warn(
            `No se pudo enviar WhatsApp de cancelación: ${err?.message ?? err}`,
          );
        }
      })();
    }

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
    return crypto.randomBytes(12).toString('hex');
  }

  /** Genera el hash SHA-256 de un token en formato hexadecimal. */
  hashearToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Clave de cifrado DEDICADA del token de gestión.
   *
   * Se deriva del secreto de sesiones (`JWT_SECRET`) con HKDF: la clave de
   * cifrado NUNCA es el secreto en sí, pero tampoco hace falta configurar
   * otra variable de entorno.
   *
   * Consecuencia asumida: rotar `JWT_SECRET` deja descifrables los tokens
   * antiguos (el reintento devuelve la reserva sin token) y, como ya ocurre con
   * las sesiones, obliga a reemitir las credenciales.
   */
  private claveCifradoToken(): Buffer {
    return Buffer.from(
      crypto.hkdfSync(
        'sha256',
        Buffer.from(process.env.JWT_SECRET ?? '', 'utf8'),
        Buffer.from('barberia-gestion-token', 'utf8'),
        Buffer.from('v1', 'utf8'),
        32,
      ),
    );
  }

  /**
   * Cifra el token de gestión (AES-256-GCM).
   *
   * El token NUNCA se guarda en texto claro: se guarda su HASH (para validar)
   * y esta copia CIFRADA (para poder reproducir la respuesta original en un
   * reintento idempotente).
   */
  cifrarTokenGestion(token: string): string {
    const iv = crypto.randomBytes(12);
    const cifrador = crypto.createCipheriv(
      'aes-256-gcm',
      this.claveCifradoToken(),
      iv,
    );
    const cifrado = Buffer.concat([
      cifrador.update(token, 'utf8'),
      cifrador.final(),
    ]);

    return Buffer.concat([iv, cifrador.getAuthTag(), cifrado]).toString(
      'base64',
    );
  }

  /**
   * Descifra el token de gestión guardado.
   *
   * @returns El token, o `null` si no hay copia cifrada o si la clave cambió
   * (p. ej. por una rotación de `JWT_SECRET`). En ese caso el reintento
   * devuelve la reserva SIN token: el token original sigue siendo válido para
   * gestionarla.
   */
  descifrarTokenGestion(cifrado: string | null): string | null {
    if (!cifrado) {
      return null;
    }

    try {
      const bruto = Buffer.from(cifrado, 'base64');
      const iv = bruto.subarray(0, 12);
      const tag = bruto.subarray(12, 28);
      const cuerpo = bruto.subarray(28);

      const descifrador = crypto.createDecipheriv(
        'aes-256-gcm',
        this.claveCifradoToken(),
        iv,
      );
      descifrador.setAuthTag(tag);

      return Buffer.concat([
        descifrador.update(cuerpo),
        descifrador.final(),
      ]).toString('utf8');
    } catch {
      this.logger.warn(
        'No se pudo descifrar el token de gestión (clave distinta o dato corrupto): el reintento devolverá la reserva sin token.',
      );

      return null;
    }
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

      if (
        dto.telefono &&
        (!existente.telefono || existente.telefono !== dto.telefono.trim())
      ) {
        await this.clientesRepository.actualizarPerfil(existente.id, {
          telefono: dto.telefono.trim(),
        });
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

      // El barbero no tiene horario que cubra la hora (distinto de "la franja
      // está ocupada"): son dos conflictos distintos y cada uno tiene su
      // código estable.
      if (franja.estado === EstadoFranja.OUTSIDE_SCHEDULE) {
        throw new DomainConflictException(
          'El barbero no tiene horario semanal que cubra la hora solicitada.',
          CODIGOS_CONFLICTO.BARBER_NO_SCHEDULE,
        );
      }

      throw new DomainConflictException(mensaje, CODIGOS_CONFLICTO.SLOT_TAKEN);
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
   * Responde a un REINTENTO idempotente: devuelve la reserva original.
   *
   * - Si el intento es materialmente el mismo, se recupera la reserva.
   * - Si el contenido difiere, la clave se ha reutilizado con una petición
   *   incompatible: conflicto explícito (409).
   *
   * En una reserva de INVITADO se devuelve el token de gestión ORIGINAL
   * (descifrado de la copia cifrada): la respuesta de un reintento es
   * EXACTAMENTE la misma que la original. No se rota NADA, de modo que la
   * idempotencia no puede invalidar en silencio una credencial que el cliente
   * ya tiene, y no hay carreras entre reintentos simultáneos (el reintento
   * solo lee).
   */
  private async responderReplay(
    previa: ReservaRegistro,
    dto: CrearReservaDto,
    cliente: {
      clienteDeReserva: ClienteDeReserva;
      clienteIdConocido: number | null;
    },
  ): Promise<ReservaCreadaResponseDto> {
    // Un solo criterio de "es el mismo intento" (el del repositorio).
    this.comprobarMismoIntento(previa, this.firmaDeIntento(dto, cliente));

    const servicio = await this.obtenerServicio(dto.servicioId);

    return this.construirRespuesta(
      previa,
      dto.fecha,
      servicio,
      this.descifrarTokenGestion(previa.gestionTokenCifrado) ?? undefined,
    );
  }

  /**
   * Firma material del intento de reserva, calculada desde el DTO.
   *
   * Es la MISMA firma que usa el repositorio dentro de la transacción: un
   * solo criterio de "es el mismo intento".
   */
  private firmaDeIntento(
    dto: CrearReservaDto,
    cliente: {
      clienteDeReserva: ClienteDeReserva;
      clienteIdConocido: number | null;
    },
  ): FirmaIntentoReserva {
    return {
      barberoId: dto.barberoId,
      servicioId: dto.servicioId,
      date: this.aFechaDate(dto.fecha),
      startTime: dto.hora,
      clienteId:
        'clienteId' in cliente.clienteDeReserva
          ? cliente.clienteDeReserva.clienteId
          : null,
    };
  }

  /**
   * Crea la reserva traduciendo la violación de unicidad (`P2002`) a un 409 con el mensaje de CA-03. La garantía real contra el doble booking es el índice UNIQUE de la base (D-17); el chequeo previo de disponibilidad no basta para dos peticiones concurrentes.
   */
  private async crearConManejoDeConflicto(
    datos: CrearReservaDatos,
  ): Promise<ReservaRegistro> {
    try {
      return await this.reservasRepository.crearConBloqueo(datos, {
        revalidar: (tx, negocioId) =>
          this.revalidarEnTransaccion(tx, datos, negocioId),
      });
    } catch (error) {
      // El índice UNIQUE puede haberse violado por DOS motivos:
      //  - el de idempotencia: dos peticiones CONCURRENTES con la misma clave.
      //    Una ha ganado; la otra recupera esa reserva (si el intento es el
      //    mismo) o recibe un conflicto explícito (si el intento es distinto).
      //  - el de ocupación de franja: la franja la ocupó OTRO cliente. Antes
      //    de rechazar hay que descartar que sea NUESTRO propio intento
      //    concurrente (mismo barbero, misma franja y misma clave).
      if (
        datos.idempotencyKey &&
        (this.esViolacionDeIdempotencia(error) ||
          this.esViolacionDeUnicidad(error))
      ) {
        const original =
          await this.reservasRepository.obtenerPorClaveDeIdempotencia(
            datos.idempotencyKey,
          );

        if (original) {
          return this.comprobarMismoIntento(original, {
            barberoId: datos.barberoId,
            servicioId: datos.servicioId,
            date: datos.date,
            startTime: datos.startTime,
            clienteId:
              'clienteId' in datos.cliente ? datos.cliente.clienteId : null,
          });
        }
      }

      if (this.esViolacionDeUnicidad(error)) {
        throw await this.conflictoDeFranjaOcupada(datos);
      }

      throw error;
    }
  }

  /**
   * Comprueba que la reserva recuperada por la clave de idempotencia
   * corresponde al MISMO intento.
   *
   * Si la clave se reutilizó con una petición materialmente distinta, es un
   * conflicto explícito: no se devuelve una reserva ajena al intento.
   */
  private comprobarMismoIntento(
    original: ReservaRegistro,
    firma: FirmaIntentoReserva,
  ): ReservaRegistro {
    // Se reutiliza la MISMA regla que usa el repositorio dentro de la
    // transacción: un solo criterio de "es el mismo intento".
    if (!mismaFirmaReserva(original, firma)) {
      throw new DomainConflictException(
        'La clave de idempotencia ya se usó para una reserva distinta.',
        CODIGOS_CONFLICTO.IDEMPOTENCY_KEY_CONFLICT,
      );
    }

    return original;
  }

  /**
   * REVALIDACIÓN dentro de la transacción de creación.
   *
   * La disponibilidad se consultó ANTES de la transacción: entre esa consulta
   * y la confirmación el estado puede haber cambiado. Aquí se vuelve a
   * comprobar, DENTRO de la transacción y con los mismos datos que usará la
   * inserción:
   *
   * 1. El barbero existe, es ACTIVO y es de este negocio.
   * 2. El servicio existe, es ACTIVO y es de este negocio.
   * 3. El barbero SIGUE prestando el servicio.
   * 4. El barbero tiene una franja semanal que cubre la hora y la duración.
   * 5. No hay un bloqueo activo que solape la franja.
   * 6. No hay un cierre general que cubra la franja.
   * 7. La franja no está ocupada por otra reserva que ocupa agenda.
   *
   * Los predicados de disponibilidad son los MISMOS que usa la fachada
   * (`reglas-disponibilidad-puras`): no hay dos criterios de disponibilidad.
   */
  private async revalidarEnTransaccion(
    tx: Prisma.TransactionClient,
    datos: CrearReservaDatos,
    negocioId: number,
  ): Promise<void> {
    const franja = { startTime: datos.startTime, endTime: datos.endTime };

    const barbero = await tx.barbero.findFirst({
      where: { id: datos.barberoId, negocioId: negocioId },
      select: { id: true, estado: true },
    });

    if (!barbero) {
      throw new NotFoundException(
        `El barbero ${datos.barberoId} no existe en esta barbería`,
      );
    }

    if (barbero.estado !== 'ACTIVO') {
      throw new DomainConflictException(
        'El barbero no está activo: no se puede confirmar la reserva.',
        CODIGOS_CONFLICTO.BARBER_INACTIVE,
      );
    }

    const servicio = await tx.servicio.findFirst({
      where: { id: datos.servicioId, negocioId: negocioId },
      select: { id: true, estado: true },
    });

    if (!servicio) {
      throw new NotFoundException(
        `El servicio ${datos.servicioId} no existe en esta barbería`,
      );
    }

    if (servicio.estado !== 'ACTIVO') {
      throw new DomainConflictException(
        'El servicio no está activo: no se puede confirmar la reserva.',
        CODIGOS_CONFLICTO.SERVICE_INACTIVE,
      );
    }

    const asignacion = await tx.barberoServicio.findFirst({
      where: {
        barberoId: datos.barberoId,
        servicioId: datos.servicioId,
        negocioId: negocioId,
      },
      select: { barberoId: true },
    });

    if (!asignacion) {
      throw new DomainConflictException(
        'El barbero ya no presta el servicio solicitado.',
        CODIGOS_CONFLICTO.NO_BARBER_FOR_SERVICE,
      );
    }

    const franjasHorario = await tx.barberWeeklySlot.findMany({
      where: {
        barberoId: datos.barberoId,
        negocioId: negocioId,
        active: true,
        dayOfWeek: datos.dayOfWeek,
      },
      select: { startTime: true, endTime: true },
    });

    if (estaFueraDelHorarioSemanal(franja, franjasHorario)) {
      throw new DomainConflictException(
        'El barbero no tiene horario semanal que cubra la hora solicitada.',
        CODIGOS_CONFLICTO.BARBER_NO_SCHEDULE,
      );
    }

    const bloqueos = await tx.barberScheduleBlock.findMany({
      where: {
        barberoId: datos.barberoId,
        negocioId: negocioId,
        status: 'ACTIVE',
        date: datos.date,
      },
      select: { startTime: true, endTime: true },
    });

    if (estaCubiertaPorBloqueo(franja, bloqueos)) {
      throw new DomainConflictException(
        MENSAJE_FRANJA_OCUPADA,
        CODIGOS_CONFLICTO.SLOT_TAKEN,
      );
    }

    const cierres = await tx.generalClosure.findMany({
      where: {
        negocioId: negocioId,
        active: true,
        date: datos.date,
      },
      select: { allDay: true, startTime: true, endTime: true },
    });

    if (estaCubiertaPorCierreGeneral(franja, cierres)) {
      throw new DomainConflictException(
        MENSAJE_FRANJA_OCUPADA,
        CODIGOS_CONFLICTO.SLOT_TAKEN,
      );
    }

    const reservas = await tx.reservation.findMany({
      where: {
        barberoId: datos.barberoId,
        negocioId: negocioId,
        date: datos.date,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
        // La reserva que lleva NUESTRA clave de idempotencia es este mismo
        // intento: no ocupa la franja contra sí mismo.
        ...(datos.idempotencyKey !== undefined
          ? { idempotencyKey: { not: datos.idempotencyKey } }
          : {}),
      },
      select: { startTime: true, endTime: true },
    });

    if (solapaConReserva(franja, reservas)) {
      throw new DomainConflictException(
        MENSAJE_FRANJA_OCUPADA,
        CODIGOS_CONFLICTO.SLOT_TAKEN,
      );
    }
  }

  /**
   * Conflicto de franja ocupada, con hasta tres HORARIOS ALTERNATIVOS libres
   * del mismo barbero y la misma fecha.
   *
   * Los alternativa se calculan DESPUÉS del fallo, con la disponibilidad
   * actualizada: si la franja se perdió por una reserva concurrente, ya no
   * aparecerá como libre. No se inventan horarios: si no se pueden calcular,
   * la lista va vacía.
   */
  private async conflictoDeFranjaOcupada(
    datos: CrearReservaDatos,
  ): Promise<DomainConflictException> {
    const horariosAlternativos = await this.calcularHorariosAlternativos(datos);

    return new DomainConflictException(
      MENSAJE_FRANJA_OCUPADA,
      CODIGOS_CONFLICTO.SLOT_TAKEN,
      { horariosAlternativos },
    );
  }

  /** Hasta tres franjas libres del mismo barbero y la misma fecha. */
  private async calcularHorariosAlternativos(
    datos: CrearReservaDatos,
  ): Promise<Array<{ hora: string; horaFin: string }>> {
    try {
      const franjas = await this.disponibilidadService.calcularDisponibilidad({
        barberoId: datos.barberoId,
        servicioId: datos.servicioId,
        fecha: this.aFechaCalendario(datos.date),
      });

      return franjas
        .filter((franja) => franja.estado === EstadoFranja.AVAILABLE)
        .slice(0, 3)
        .map((franja) => ({
          hora: franja.startTime,
          horaFin: franja.endTime,
        }));
    } catch {
      // Si la disponibilidad no se puede calcular, no se inventa nada: la
      // lista de alternativas queda vacía.
      return [];
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
      if (this.esViolacionDeUnicidad(error)) {
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

  private esViolacionDeUnicidad(error: unknown): boolean {
    return (error as { code?: unknown } | null)?.code === 'P2002';
  }

  /**
   * `true` si el error es un conflicto de FRANJA (409 con el código
   * `SLOT_TAKEN`).
   */
  private esConflictoDeFranja(error: unknown): boolean {
    const codigo = (
      error as { getResponse?: () => { code?: string } } | undefined
    )?.getResponse?.()?.code;

    return codigo === CODIGOS_CONFLICTO.SLOT_TAKEN;
  }

  /**
   * `true` si el error es una violación de unicidad del ÍNDICE DE IDEMPOTENCIA
   * (no el de ocupación de franja).
   *
   * Prisma informa del índice afectado en `meta.target`: en MySQL es el nombre
   * del índice; en otras versiones puede ser la lista de columnas. Se
   * comprueban las dos formas, y además se exige que la clave de idempotencia
   * NO esté entre las columnas (para no confundirla con la de ocupación).
   */
  private esViolacionDeIdempotencia(error: unknown): boolean {
    if (!this.esViolacionDeUnicidad(error)) {
      return false;
    }

    const target = (error as { meta?: { target?: unknown } }).meta?.target;

    if (typeof target === 'string') {
      return target.includes('idempotencyKey');
    }

    if (Array.isArray(target)) {
      return (
        target.includes('idempotencyKey') && !target.includes('slotActivo')
      );
    }

    return false;
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

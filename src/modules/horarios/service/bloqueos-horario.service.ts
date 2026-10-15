import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { FranjaFactory, FranjaHorario } from '../factory/franja.factory';
import { FechaBogotaService } from '../common/fecha-bogota.service';
import { HorariosRepository } from '../repository/horarios.repository';
import {
  ActualizarBloqueoDatos,
  BloqueoHorarioRegistro,
  BloqueosHorarioRepository,
} from '../repository/bloqueos-horario.repository';
import { CierresGeneralesRepository } from '../repository/cierres-generales.repository';
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';
import { ScheduleBlockStatus } from '../../../../generated/prisma/enums';
import {
  PROVEEDOR_RESERVAS_ACTIVAS,
  ReservasNoDisponiblesError,
} from '../ports/proveedor-reservas-activas.port';
import type { ProveedorReservasActivas } from '../ports/proveedor-reservas-activas.port';
import {
  CODIGOS_CONFLICTO,
  DomainConflictException,
} from '../../../common/exceptions/domain-conflict.exception';
import { CrearBloqueoHorarioDto } from '../dto/dto-peticion/crear-bloqueo-horario.dto';
import { ActualizarBloqueoHorarioDto } from '../dto/dto-peticion/actualizar-bloqueo-horario.dto';
import { FiltroBloqueosHorarioDto } from '../dto/dto-peticion/filtro-bloqueos-horario.dto';
import {
  BloqueoHorarioAccionResponseDto,
  BloqueoHorarioResponseDto,
} from '../dto/dto-respuesta/bloqueo-horario-response.dto';

/**
 * Servicio de HE08-HU-03, HE08-HU-05 y HE08-HU-06: ciclo de vida completo de
 * los bloqueos de horario del barbero autenticado.
 *
 * El barbero nunca se recibe por parámetro ni por el body: siempre se resuelve
 * a partir del usuario autenticado. Toda transición de estado se centraliza
 * aquí; no se acepta un estado enviado por el cliente.
 *
 * La verificación de reservas activas (HE-04) se delega en
 * `ProveedorReservasActivas`. Mientras HE-04 no esté integrado, esa
 * verificación falla de forma cerrada (503): crear o mover un bloqueo se
 * rechaza en lugar de omitir la regla `SCHEDULE_BLOCK_HAS_RESERVATIONS`.
 */
@Injectable()
export class BloqueosHorarioService {
  private readonly logger = new Logger(BloqueosHorarioService.name);

  constructor(
    private readonly bloqueosRepository: BloqueosHorarioRepository,
    private readonly cierresRepository: CierresGeneralesRepository,
    private readonly horariosRepository: HorariosRepository,
    private readonly barberosRepository: BarberosRepository,
    private readonly franjaFactory: FranjaFactory,
    private readonly fechaBogotaService: FechaBogotaService,
    @Inject(PROVEEDOR_RESERVAS_ACTIVAS)
    private readonly proveedorReservas: ProveedorReservasActivas,
  ) {}

  /**
   * HE08-HU-03 / HE08-HU-05: crea un bloqueo `ACTIVE` para el barbero
   * autenticado tras validar fecha, horario, solapamientos, cierres y reservas.
   */
  async crearBloqueo(
    usuarioAutenticado: any,
    dto: CrearBloqueoHorarioDto,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);
    const fecha = this.validarFecha(dto.date);
    const franjas = this.generarFranjasDelBloqueo(dto.startTime, dto.endTime);

    await this.validarDentroDelHorarioSemanal(barbero.id, dto.date, franjas);
    await this.validarSinSolapamientoConBloqueos(
      barbero.id,
      fecha,
      dto.startTime,
      dto.endTime,
    );
    await this.validarSinCierreGeneral(fecha, dto.startTime, dto.endTime);
    await this.asegurarSinReservasActivas(
      barbero.id,
      dto.date,
      dto.startTime,
      dto.endTime,
    );

    const creado = await this.bloqueosRepository.crear({
      barberoId: barbero.id,
      date: fecha,
      startTime: dto.startTime,
      endTime: dto.endTime,
      reason: dto.reason ?? null,
      notes: dto.notes ?? null,
    });

    this.logger.log(
      `AUDIT: bloqueo creado id=${creado.id} barberoId=${barbero.id} fecha=${dto.date} ${dto.startTime}-${dto.endTime}`,
    );
    return this.mapearAccion('Bloqueo creado correctamente', creado);
  }

  /**
   * Lista los bloqueos del barbero autenticado con filtros opcionales por fecha
   * y estado.
   */
  async listarBloqueos(
    usuarioAutenticado: any,
    filtro: FiltroBloqueosHorarioDto,
  ): Promise<BloqueoHorarioResponseDto[]> {
    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);
    const date =
      filtro.fecha !== undefined ? this.validarFecha(filtro.fecha) : undefined;

    const registros = await this.bloqueosRepository.listarPorBarbero(
      barbero.id,
      { date, status: filtro.status },
    );
    return registros.map((registro) => this.mapearBloqueo(registro));
  }

  /**
   * HE08-HU-03 / HE08-HU-05: modifica parcialmente un bloqueo `ACTIVE` del
   * barbero autenticado. Si el cambio altera fecha u horas, revalida el horario
   * semanal, los solapamientos, los cierres y las reservas antes de persistir.
   */
  async actualizarBloqueo(
    usuarioAutenticado: any,
    id: number,
    dto: ActualizarBloqueoHorarioDto,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);
    const bloqueo = await this.obtenerBloqueoDelBarbero(barbero.id, id);
    this.asegurarEstadoActivo(bloqueo, 'editar');

    const fecha =
      dto.date !== undefined ? this.validarFecha(dto.date) : bloqueo.date;
    const startTime = dto.startTime ?? bloqueo.startTime;
    const endTime = dto.endTime ?? bloqueo.endTime;
    const fechaTexto = this.formatearFecha(fecha);

    const cambiaHorario =
      fechaTexto !== this.formatearFecha(bloqueo.date) ||
      startTime !== bloqueo.startTime ||
      endTime !== bloqueo.endTime;

    if (cambiaHorario) {
      const franjas = this.generarFranjasDelBloqueo(startTime, endTime);
      await this.validarDentroDelHorarioSemanal(
        barbero.id,
        fechaTexto,
        franjas,
      );
      await this.validarSinSolapamientoConBloqueos(
        barbero.id,
        fecha,
        startTime,
        endTime,
        bloqueo.id,
      );
      await this.validarSinCierreGeneral(fecha, startTime, endTime);
      await this.asegurarSinReservasActivas(
        barbero.id,
        fechaTexto,
        startTime,
        endTime,
      );
    }

    const datos: ActualizarBloqueoDatos = {
      date: fecha,
      startTime,
      endTime,
      reason: dto.reason !== undefined ? dto.reason : bloqueo.reason,
      notes: dto.notes !== undefined ? dto.notes : bloqueo.notes,
    };

    const actualizado = await this.bloqueosRepository.actualizar(
      bloqueo.id,
      datos,
    );

    this.logger.log(
      `AUDIT: bloqueo actualizado id=${bloqueo.id} barberoId=${barbero.id}`,
    );
    return this.mapearAccion('Bloqueo actualizado correctamente', actualizado);
  }

  /**
   * HE08-HU-05: cancela lógicamente un bloqueo (`ACTIVE -> CANCELLED`) sin
   * borrar la fila. Otras causas de no disponibilidad (reserva, cierre) siguen
   * aplicando.
   */
  async cancelarBloqueo(
    usuarioAutenticado: any,
    id: number,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);
    const bloqueo = await this.obtenerBloqueoDelBarbero(barbero.id, id);
    this.asegurarEstadoActivo(bloqueo, 'cancelar');

    const actualizado = await this.bloqueosRepository.actualizar(bloqueo.id, {
      status: ScheduleBlockStatus.CANCELLED,
    });

    this.logger.log(
      `AUDIT: bloqueo cancelado id=${bloqueo.id} barberoId=${barbero.id}`,
    );
    return this.mapearAccion('Bloqueo cancelado correctamente', actualizado);
  }

  /**
   * HE08-HU-06: reactiva/libera lógicamente un bloqueo
   * (`ACTIVE -> REACTIVATED`), registrando `reactivatedAt` y `reactivatedBy`.
   * El bloqueo deja de excluir disponibilidad, pero se conserva el historial.
   */
  async reactivarBloqueo(
    usuarioAutenticado: any,
    id: number,
  ): Promise<BloqueoHorarioAccionResponseDto> {
    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);
    const bloqueo = await this.obtenerBloqueoDelBarbero(barbero.id, id);
    this.asegurarEstadoActivo(bloqueo, 'reactivar');

    const usuarioId = this.resolverUsuarioId(usuarioAutenticado);
    const actualizado = await this.bloqueosRepository.actualizar(bloqueo.id, {
      status: ScheduleBlockStatus.REACTIVATED,
      reactivatedAt: new Date(),
      reactivatedBy: usuarioId,
    });

    this.logger.log(
      `AUDIT: bloqueo reactivado id=${bloqueo.id} barberoId=${barbero.id}`,
    );
    return this.mapearAccion('Bloqueo reactivado correctamente', actualizado);
  }

  /**
   * Resuelve el perfil de barbero del usuario autenticado.
   * Lanza 403 si el usuario no está relacionado con un barbero.
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

    return barbero;
  }

  /**
   * Extrae el `Usuario.id` del payload JWT. El guard publica `id` (numérico) y
   * `sub` (string); ambos corresponden al ID del usuario, nunca al del barbero.
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

  /**
   * Recupera un bloqueo verificando propiedad. Un bloqueo inexistente o de otro
   * barbero se trata igual (404) para no revelar la existencia de bloques ajenos.
   */
  private async obtenerBloqueoDelBarbero(
    barberoId: number,
    id: number,
  ): Promise<BloqueoHorarioRegistro> {
    const bloqueo = await this.bloqueosRepository.obtenerPorId(id);

    if (!bloqueo || bloqueo.barberoId !== barberoId) {
      throw new NotFoundException(
        'El bloqueo no existe o no pertenece al barbero autenticado',
      );
    }

    return bloqueo;
  }

  /**
   * Centraliza las transiciones de estado. Solo `ACTIVE` admite editar,
   * cancelar o reactivar; cualquier otra transición se rechaza con 409.
   */
  private asegurarEstadoActivo(
    bloqueo: BloqueoHorarioRegistro,
    accion: string,
  ): void {
    if (bloqueo.status !== ScheduleBlockStatus.ACTIVE) {
      throw new ConflictException(
        `No se puede ${accion} un bloqueo en estado ${bloqueo.status}: solo los bloqueos ACTIVE admiten esta transición`,
      );
    }
  }

  /**
   * Valida la fecha de calendario y la convierte a un `Date` en UTC (medianoche)
   * para no arrastrar desplazamientos de zona horaria en columnas `@db.Date`.
   */
  private validarFecha(fecha: string): Date {
    if (!this.fechaBogotaService.esFechaCalendarioValida(fecha)) {
      throw new BadRequestException(
        `Fecha inválida: "${fecha}". Se esperaba una fecha de calendario YYYY-MM-DD`,
      );
    }

    return new Date(`${fecha}T00:00:00.000Z`);
  }

  private formatearFecha(fecha: Date): string {
    return fecha.toISOString().slice(0, 10);
  }

  /**
   * Resuelve el rango del bloqueo en franjas completas de 60 minutos,
   * reutilizando `FranjaFactory` como única fuente de verdad para formato,
   * jornada, alineación, duración y `endTime > startTime`.
   */
  private generarFranjasDelBloqueo(
    startTime: string,
    endTime: string,
  ): FranjaHorario[] {
    try {
      return this.franjaFactory.generarFranjas(startTime, endTime);
    } catch (error) {
      throw new BadRequestException(
        `Horario del bloqueo inválido (${startTime}-${endTime}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Cada franja de 60 minutos del bloqueo debe existir en el horario semanal del
   * barbero para ese día.
   */
  private async validarDentroDelHorarioSemanal(
    barberoId: number,
    fechaTexto: string,
    franjas: FranjaHorario[],
  ): Promise<void> {
    const diaSemana = this.fechaBogotaService.obtenerDiaSemana(fechaTexto);
    const franjasHorario =
      await this.horariosRepository.obtenerFranjasActivasPorBarberoYDia(
        barberoId,
        diaSemana,
      );
    const iniciosPermitidos = new Set(
      franjasHorario.map((franja) => franja.startTime),
    );

    const fueraDeHorario = franjas.filter(
      (franja) => !iniciosPermitidos.has(franja.startTime),
    );

    if (fueraDeHorario.length > 0) {
      throw new BadRequestException(
        `El bloqueo debe estar dentro del horario semanal del barbero para ese día (BLOCK_OUTSIDE_SCHEDULE). Franjas fuera de horario: ${fueraDeHorario
          .map((franja) => franja.startTime)
          .join(', ')}`,
      );
    }
  }

  /**
   * Un bloqueo `ACTIVE` no puede solaparse con otro bloqueo `ACTIVE` del mismo
   * barbero en la misma fecha. Se compara por intervalos `[inicio, fin)`.
   */
  private async validarSinSolapamientoConBloqueos(
    barberoId: number,
    fecha: Date,
    startTime: string,
    endTime: string,
    excluirId?: number,
  ): Promise<void> {
    const activos = await this.bloqueosRepository.listarActivosPorBarberoYFecha(
      barberoId,
      fecha,
    );

    const inicioNuevo = this.franjaFactory.aMinutos(startTime);
    const finNuevo = this.franjaFactory.aMinutos(endTime);

    const solapado = activos.find((bloqueo) => {
      if (excluirId !== undefined && bloqueo.id === excluirId) {
        return false;
      }
      const inicioBloqueo = this.franjaFactory.aMinutos(bloqueo.startTime);
      const finBloqueo = this.franjaFactory.aMinutos(bloqueo.endTime);
      return inicioBloqueo < finNuevo && finBloqueo > inicioNuevo;
    });

    if (solapado) {
      throw new BadRequestException(
        `El bloqueo se solapa con otro bloqueo activo (${solapado.startTime}-${solapado.endTime}) (SLOT_OVERLAP)`,
      );
    }
  }

  /**
   * El bloqueo no puede coincidir con un cierre general activo. Un cierre
   * `allDay` cubre todo el día; uno parcial se compara por intervalos.
   */
  private async validarSinCierreGeneral(
    fecha: Date,
    startTime: string,
    endTime: string,
  ): Promise<void> {
    const cierres = await this.cierresRepository.obtenerActivosEnFecha(fecha);

    const inicioNuevo = this.franjaFactory.aMinutos(startTime);
    const finNuevo = this.franjaFactory.aMinutos(endTime);

    const coincide = cierres.some((cierre) => {
      if (cierre.allDay) {
        return true;
      }
      if (!cierre.startTime || !cierre.endTime) {
        return false;
      }
      const inicioCierre = this.franjaFactory.aMinutos(cierre.startTime);
      const finCierre = this.franjaFactory.aMinutos(cierre.endTime);
      return inicioCierre < finNuevo && finCierre > inicioNuevo;
    });

    if (coincide) {
      throw new BadRequestException(
        'El bloqueo coincide con un cierre general activo',
      );
    }
  }

  /**
   * Verifica que el rango no contenga reservas no canceladas. Mientras HE-04 no
   * esté integrado, el proveedor lanza `ReservasNoDisponiblesError` y la
   * operación se rechaza con 503 en lugar de omitir la verificación.
   */
  private async asegurarSinReservasActivas(
    barberoId: number,
    fecha: string,
    startTime: string,
    endTime: string,
  ): Promise<void> {
    let existeReserva: boolean;

    try {
      existeReserva =
        await this.proveedorReservas.existeReservaNoCanceladaEnFranja({
          barberoId,
          fecha,
          startTime,
          endTime,
        });
    } catch (error) {
      if (error instanceof ReservasNoDisponiblesError) {
        throw new ServiceUnavailableException(
          'No es posible verificar reservas activas: la integración con HE-04 todavía no está disponible. La operación se rechaza para no omitir la regla SCHEDULE_BLOCK_HAS_RESERVATIONS.',
        );
      }
      throw error;
    }

    if (existeReserva) {
      throw new DomainConflictException(
        'El rango contiene una reserva no cancelada',
        CODIGOS_CONFLICTO.SCHEDULE_BLOCK_HAS_RESERVATIONS,
        { barberoId, fecha, startTime, endTime },
      );
    }
  }

  private mapearAccion(
    mensaje: string,
    registro: BloqueoHorarioRegistro,
  ): BloqueoHorarioAccionResponseDto {
    return {
      mensaje,
      block: this.mapearBloqueo(registro),
    };
  }

  private mapearBloqueo(
    registro: BloqueoHorarioRegistro,
  ): BloqueoHorarioResponseDto {
    return {
      id: registro.id,
      date: this.formatearFecha(registro.date),
      startTime: registro.startTime,
      endTime: registro.endTime,
      reason: registro.reason,
      notes: registro.notes,
      status: registro.status,
      createdAt: registro.createdAt.toISOString(),
      updatedAt: registro.updatedAt.toISOString(),
      reactivatedAt: registro.reactivatedAt
        ? registro.reactivatedAt.toISOString()
        : null,
    };
  }
}

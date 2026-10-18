import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DURACION_FRANJA_MINUTOS,
  FranjaFactory,
  FranjaHorario,
} from '../factory/franja.factory';
import {
  FranjaHorarioPersistencia,
  HorariosRepository,
} from '../repository/horarios.repository';
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';
import {
  PROVEEDOR_RESERVAS_ACTIVAS,
  ReservasNoDisponiblesError,
} from '../ports/proveedor-reservas-activas.port';
import type { ProveedorReservasActivas } from '../ports/proveedor-reservas-activas.port';
import {
  CODIGOS_CONFLICTO,
  DomainConflictException,
} from '../../../common/exceptions/domain-conflict.exception';
import {
  FranjaHorarioSemanalPeticionDto,
  ReemplazarHorarioSemanalDto,
} from '../dto/dto-peticion/reemplazar-horario-semanal.dto';
import {
  FranjaHorarioSemanalDto,
  HorarioSemanalResponseDto,
} from '../dto/dto-respuesta/horario-semanal-response.dto';

/**
 * Servicio de HE08-HU-01 y HE08-HU-02: consulta y reemplazo del horario
 * semanal del barbero autenticado.
 *
 * El barbero nunca se recibe por parámetro ni por el body: siempre se resuelve
 * a partir del usuario autenticado, de modo que un usuario solo pueda operar
 * sobre su propio horario.
 */
@Injectable()
export class HorarioSemanalService {
  constructor(
    private readonly horariosRepository: HorariosRepository,
    private readonly barberosRepository: BarberosRepository,
    private readonly franjaFactory: FranjaFactory,
    @Inject(PROVEEDOR_RESERVAS_ACTIVAS)
    private readonly proveedorReservas: ProveedorReservasActivas,
  ) {}

  /**
   * HU-01: Retorna el horario semanal vigente del barbero autenticado.
   */
  async obtenerMiHorarioSemanal(
    usuarioAutenticado: any,
  ): Promise<HorarioSemanalResponseDto> {
    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);
    return this.ejecutarObtenerHorario(barbero.id);
  }

  /**
   * HE08-HU-01: Reemplaza por completo el horario semanal del barbero
   * autenticado.
   *
   * Valida cada franja (formato, jornada, alineación y duración fija de 60
   * minutos) y que no existan duplicados ni solapamientos dentro de un mismo
   * día.
   *
   * Eliminar o reducir una franja existente solo se rechaza si esa franja
   * contiene reservas no canceladas: la verificación se delega en
   * `ProveedorReservasActivas` (HE-04). Mientras HE-04 no esté integrado, esa
   * verificación falla de forma cerrada (503) en lugar de asumir que no hay
   * reservas afectadas.
   */
  async reemplazarMiHorarioSemanal(
    usuarioAutenticado: any,
    dto: ReemplazarHorarioSemanalDto,
  ): Promise<HorarioSemanalResponseDto> {
    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);
    return this.ejecutarReemplazoHorario(barbero.id, dto);
  }

  /**
   * SUPERADMIN: Consulta el horario semanal de cualquier barbero por su barberoId.
   */
  async obtenerHorarioSemanalDeBarbero(
    barberoId: number,
  ): Promise<HorarioSemanalResponseDto> {
    const barbero =
      await this.barberosRepository.obtenerBarberoActivoPorId(barberoId);
    if (!barbero) {
      throw new NotFoundException(
        `El barbero con ID ${barberoId} no existe o no está activo`,
      );
    }

    return this.ejecutarObtenerHorario(barbero.id);
  }

  /**
   * SUPERADMIN: Reemplaza el horario semanal de cualquier barbero por su barberoId,
   * respetando la regla de no afectar reservas existentes.
   */
  async reemplazarHorarioSemanalDeBarbero(
    barberoId: number,
    dto: ReemplazarHorarioSemanalDto,
  ): Promise<HorarioSemanalResponseDto> {
    const barbero =
      await this.barberosRepository.obtenerBarberoActivoPorId(barberoId);
    if (!barbero) {
      throw new NotFoundException(
        `El barbero con ID ${barberoId} no existe o no está activo`,
      );
    }

    return this.ejecutarReemplazoHorario(barbero.id, dto);
  }

  private async ejecutarObtenerHorario(
    barberoId: number,
  ): Promise<HorarioSemanalResponseDto> {
    const franjas =
      await this.horariosRepository.obtenerFranjasActivasPorBarbero(barberoId);
    return this.mapearHorario(barberoId, franjas);
  }

  private async ejecutarReemplazoHorario(
    barberoId: number,
    dto: ReemplazarHorarioSemanalDto,
  ): Promise<HorarioSemanalResponseDto> {
    const franjas = dto.franjas ?? [];
    this.validarFranjas(franjas);

    const existentes =
      await this.horariosRepository.obtenerFranjasActivasPorBarbero(barberoId);
    await this.asegurarFranjasSinReservasActivas(
      barberoId,
      existentes,
      franjas,
    );

    const guardadas = await this.horariosRepository.reemplazarFranjas(
      barberoId,
      franjas,
    );
    return this.mapearHorario(barberoId, guardadas);
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
   * Aplica todas las reglas de negocio del horario semanal sobre la lista de
   * franjas enviada por el barbero.
   */
  private validarFranjas(franjas: FranjaHorarioSemanalPeticionDto[]): void {
    franjas.forEach((franja) => this.validarFranjaIndividual(franja));
    this.validarSolapamientos(franjas);
  }

  /**
   * Valida una franja individual reutilizando `FranjaFactory` como única
   * fuente de verdad para formato, jornada, alineación y duración. Una franja
   * válida de HE-08 debe resolverse en exactamente un bloque de 60 minutos.
   */
  private validarFranjaIndividual(
    franja: FranjaHorarioSemanalPeticionDto,
  ): void {
    let generadas: FranjaHorario[];

    try {
      generadas = this.franjaFactory.generarFranjas(
        franja.startTime,
        franja.endTime,
      );
    } catch (error) {
      throw new BadRequestException(
        `Franja inválida (${franja.dayOfWeek} ${franja.startTime}-${franja.endTime}): ${(error as Error).message}`,
      );
    }

    const primera = generadas[0];
    if (
      generadas.length !== 1 ||
      primera.startTime !== franja.startTime ||
      primera.endTime !== franja.endTime
    ) {
      throw new BadRequestException(
        `Cada franja debe durar exactamente ${DURACION_FRANJA_MINUTOS} minutos (franja inválida: ${franja.dayOfWeek} ${franja.startTime}-${franja.endTime})`,
      );
    }
  }

  /**
   * Detecta duplicados y solapamientos dentro de un mismo día. Con franjas de
   * 60 minutos alineadas esto se reduce a claves repetidas, pero se compara por
   * intervalos para no depender de la granularidad.
   */
  private validarSolapamientos(
    franjas: FranjaHorarioSemanalPeticionDto[],
  ): void {
    const franjasPorDia = new Map<string, FranjaHorarioSemanalPeticionDto[]>();

    for (const franja of franjas) {
      const lista = franjasPorDia.get(franja.dayOfWeek) ?? [];
      lista.push(franja);
      franjasPorDia.set(franja.dayOfWeek, lista);
    }

    for (const [dia, lista] of franjasPorDia) {
      const ordenadas = [...lista].sort(
        (a, b) =>
          this.franjaFactory.aMinutos(a.startTime) -
          this.franjaFactory.aMinutos(b.startTime),
      );

      for (let i = 1; i < ordenadas.length; i++) {
        const finAnterior = this.franjaFactory.aMinutos(
          ordenadas[i - 1].endTime,
        );
        const inicioActual = this.franjaFactory.aMinutos(
          ordenadas[i].startTime,
        );

        if (inicioActual < finAnterior) {
          throw new BadRequestException(
            `Las franjas del ${dia} no pueden solaparse ni duplicarse (${ordenadas[i - 1].startTime} y ${ordenadas[i].startTime})`,
          );
        }
      }
    }
  }

  /**
   * HE08-HU-01 + HE-04: eliminar o reducir una franja existente no debe
   * invalidar reservas no canceladas. Se calculan las franjas afectadas (las
   * que existían y no se conservan) y se consultan en bloque al proveedor de
   * reservas. Si alguna tiene reservas → 409 con código estable
   * `SCHEDULE_CHANGE_AFFECTS_RESERVATIONS`. Si el proveedor (HE-04) no está
   * integrado → 503 (fail-closed), en vez de asumir que no hay reservas.
   */
  private async asegurarFranjasSinReservasActivas(
    barberoId: number,
    existentes: FranjaHorarioPersistencia[],
    nuevas: FranjaHorarioSemanalPeticionDto[],
  ): Promise<void> {
    const clavesNuevas = new Set(
      nuevas.map((franja) => `${franja.dayOfWeek}|${franja.startTime}`),
    );

    const afectadas = existentes.filter(
      (franja) => !clavesNuevas.has(`${franja.dayOfWeek}|${franja.startTime}`),
    );

    // Recorrido secuencial intencional: se corta en la primera franja afectada
    // que tenga reservas activas (fail-closed). Paralelizar con Promise.all
    // cambiaría la precedencia de errores y ejecutaría consultas innecesarias.
    for (const franja of afectadas) {
      let existeReserva: boolean;

      try {
        const consultaReserva =
          this.proveedorReservas.existeReservaNoCanceladaEnFranjaSemanal({
            barberoId,
            dayOfWeek: franja.dayOfWeek,
            startTime: franja.startTime,
            endTime: franja.endTime,
          });
        // Secuencial intencional (fail-closed): se corta en la primera franja
        // con reservas activas y no se paraleliza para preservar la precedencia
        // de errores.
        existeReserva = await consultaReserva; // NOSONAR bucle secuencial intencional (fail-closed)
      } catch (error) {
        if (error instanceof ReservasNoDisponiblesError) {
          throw new ServiceUnavailableException(
            'No es posible verificar reservas activas: la integración con HE-04 todavía no está disponible. La operación se rechaza para no invalidar reservas (SCHEDULE_CHANGE_AFFECTS_RESERVATIONS).',
          );
        }
        throw error;
      }

      if (existeReserva) {
        throw new DomainConflictException(
          `No es posible eliminar, reducir ni mover la franja ${franja.dayOfWeek} ${franja.startTime}-${franja.endTime}: contiene reservas no canceladas`,
          CODIGOS_CONFLICTO.SCHEDULE_CHANGE_AFFECTS_RESERVATIONS,
          {
            dayOfWeek: franja.dayOfWeek,
            startTime: franja.startTime,
            endTime: franja.endTime,
          },
        );
      }
    }
  }

  private mapearHorario(
    barberoId: number,
    franjas: FranjaHorarioPersistencia[],
  ): HorarioSemanalResponseDto {
    return {
      barberoId,
      franjas: franjas.map((franja) => this.mapearFranja(franja)),
    };
  }

  private mapearFranja(
    franja: FranjaHorarioPersistencia,
  ): FranjaHorarioSemanalDto {
    return {
      dayOfWeek: franja.dayOfWeek,
      startTime: franja.startTime,
      endTime: franja.endTime,
    };
  }
}

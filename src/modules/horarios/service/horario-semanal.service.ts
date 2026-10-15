import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  ) {}

  /**
   * HU-01: Retorna el horario semanal vigente del barbero autenticado.
   */
  async obtenerMiHorarioSemanal(
    usuarioAutenticado: any,
  ): Promise<HorarioSemanalResponseDto> {
    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);
    const franjas =
      await this.horariosRepository.obtenerFranjasActivasPorBarbero(barbero.id);
    return this.mapearHorario(barbero.id, franjas);
  }

  /**
   * HU-02: Reemplaza por completo el horario semanal del barbero autenticado.
   *
   * Valida cada franja (formato, jornada, alineación y duración fija de 60
   * minutos) y que no existan duplicados ni solapamientos dentro de un mismo
   * día. Por ahora solo se permite agregar franjas: eliminar o mover franjas
   * existentes queda bloqueado a la espera de la verificación de reservas
   * activas que pertenece a HE-04.
   */
  async reemplazarMiHorarioSemanal(
    usuarioAutenticado: any,
    dto: ReemplazarHorarioSemanalDto,
  ): Promise<HorarioSemanalResponseDto> {
    const barbero = await this.obtenerBarberoAutenticado(usuarioAutenticado);
    const franjas = dto.franjas ?? [];

    this.validarFranjas(franjas);

    const existentes =
      await this.horariosRepository.obtenerFranjasActivasPorBarbero(barbero.id);
    this.asegurarSinFranjasAfectadas(existentes, franjas);

    const guardadas = await this.horariosRepository.reemplazarFranjas(
      barbero.id,
      franjas,
    );
    return this.mapearHorario(barbero.id, guardadas);
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
   * LÍMITE EXPLÍCITO (HE-04 pendiente): reemplazar el horario no debe eliminar
   * ni reducir una franja que afecte reservas activas. Como la verificación de
   * reservas todavía no existe, la operación se bloquea cuando la nueva lista
   * no conserva todas las franjas activas actuales, en lugar de asumir que no
   * hay reservas afectadas.
   */
  private asegurarSinFranjasAfectadas(
    existentes: FranjaHorarioPersistencia[],
    nuevas: FranjaHorarioSemanalPeticionDto[],
  ): void {
    const clavesNuevas = new Set(
      nuevas.map((franja) => `${franja.dayOfWeek}|${franja.startTime}`),
    );

    const afectadas = existentes.filter(
      (franja) => !clavesNuevas.has(`${franja.dayOfWeek}|${franja.startTime}`),
    );

    if (afectadas.length > 0) {
      throw new ConflictException(
        'No es posible eliminar, reducir ni mover franjas del horario: la verificación de reservas activas (HE-04) todavía no está integrada. Solo se permite agregar franjas. Si necesitas quitar franjas, primero cancela o reprograma las reservas afectadas.',
      );
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

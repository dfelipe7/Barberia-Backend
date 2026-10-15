import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { EstadoFranja } from '../common/estado-franja';
import type { FranjaEvaluada } from '../common/estado-franja';
import type { ConsultaDisponibilidad } from '../common/consulta-disponibilidad';
import { FechaBogotaService } from '../common/fecha-bogota.service';
import { FranjaFactory } from '../factory/franja.factory';
import { HorariosRepository } from '../repository/horarios.repository';
import { BloqueosHorarioRepository } from '../repository/bloqueos-horario.repository';
import { CierresGeneralesRepository } from '../repository/cierres-generales.repository';
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';
import { ReservasNoDisponiblesError } from '../ports/proveedor-reservas-activas.port';
import { DisponibilidadMapper } from '../mappers/disponibilidad.mapper';
import { REGLAS_DISPONIBILIDAD } from '../strategies/regla-disponibilidad.strategy';
import type {
  ContextoDisponibilidad,
  ReglaDisponibilidad,
} from '../strategies/regla-disponibilidad.strategy';
import { DisponibilidadPublicaResponseDto } from '../dto/dto-respuesta/disponibilidad-response.dto';
import type { DisponibilidadDetalladaResponseDto } from '../dto/dto-respuesta/disponibilidad-response.dto';

/**
 * Fachada de disponibilidad de HE-08 (HU-04).
 *
 * Es el **único punto de entrada** para calcular la disponibilidad de un barbero.
 * Los controllers y (a futuro) HE-04 no reimplementan reglas: consultan esta
 * fachada, que compone las reglas (strategies) en orden de prioridad y
 * reutiliza `FranjaFactory` para generar el catálogo de franjas.
 *
 * Reglas de arquitectura:
 * - Las consultas Prisma viven en los repositorios; aquí solo se aplican reglas
 *   de dominio sobre datos ya cargados.
 * - La generación de franjas nunca se duplica: se delega en `FranjaFactory`.
 * - El mapeo a DTO se delega en `DisponibilidadMapper`.
 * - `fail-closed`: mientras HE-04 no aporte el proveedor real de reservas, la
 *   fachada responde 503 en lugar de anunciar franjas potencialmente ocupadas.
 */
@Injectable()
export class DisponibilidadService {
  private readonly logger = new Logger(DisponibilidadService.name);

  constructor(
    @Inject(REGLAS_DISPONIBILIDAD)
    private readonly reglas: ReglaDisponibilidad[],
    private readonly barberosRepository: BarberosRepository,
    private readonly serviciosRepository: ServiciosRepository,
    private readonly horariosRepository: HorariosRepository,
    private readonly bloqueosRepository: BloqueosHorarioRepository,
    private readonly cierresRepository: CierresGeneralesRepository,
    private readonly franjaFactory: FranjaFactory,
    private readonly fechaBogotaService: FechaBogotaService,
    private readonly mapper: DisponibilidadMapper,
  ) {}

  /**
   * Calcula el estado efectivo de cada franja de la jornada para un barbero en
   * una fecha. Es la fuente de verdad única que HE-04 debe consumir.
   *
   * @throws BadRequestException si la fecha es inválida o el servicio no está
   *   asignado al barbero.
   * @throws NotFoundException si el barbero (o el servicio) no existe o no está activo.
   * @throws ServiceUnavailableException si el proveedor de reservas (HE-04) no
   *   está disponible (`fail-closed`).
   */
  async calcularDisponibilidad(
    consulta: ConsultaDisponibilidad,
  ): Promise<FranjaEvaluada[]> {
    const contexto = await this.construirContexto(consulta);
    const catalogo = this.franjaFactory.generarCatalogoDelDia();
    const reglas = [...this.reglas].sort((a, b) => a.orden - b.orden);

    const franjas: FranjaEvaluada[] = [];

    try {
      for (const franja of catalogo) {
        let estado: EstadoFranja = EstadoFranja.AVAILABLE;

        for (const regla of reglas) {
          const resultado = await regla.evaluar(franja, contexto);
          if (resultado !== null && resultado !== undefined) {
            estado = resultado;
            break;
          }
        }

        franjas.push({
          startTime: franja.startTime,
          endTime: franja.endTime,
          estado,
        });
      }
    } catch (error) {
      if (error instanceof ReservasNoDisponiblesError) {
        throw new ServiceUnavailableException(
          'No es posible calcular la disponibilidad: la verificación de reservas activas (HE-04) todavía no está integrada. La consulta se rechaza para no anunciar franjas potencialmente ocupadas.',
        );
      }
      throw error;
    }

    return franjas;
  }

  /**
   * Vista pública (spec §9.8): solo franjas disponibles y sin motivos privados.
   */
  async obtenerDisponibilidadPublica(
    consulta: ConsultaDisponibilidad,
  ): Promise<DisponibilidadPublicaResponseDto> {
    const franjas = await this.calcularDisponibilidad(consulta);
    return this.mapper.aPublica(consulta, franjas);
  }

  /**
   * Vista detallada: expone el estado de cada franja. Reservada a endpoints
   * autenticados del propio barbero y al consumo interno de HE-04.
   */
  async obtenerDisponibilidadDetallada(
    consulta: ConsultaDisponibilidad,
  ): Promise<DisponibilidadDetalladaResponseDto> {
    const franjas = await this.calcularDisponibilidad(consulta);
    return this.mapper.aDetallada(consulta, franjas);
  }

  /**
   * Vista detallada del barbero autenticado. La identidad del barbero nunca se
   * recibe del cliente: se resuelve desde el token, igual que en el resto de
   * endpoints `me`.
   *
   * @throws UnauthorizedException si no se puede identificar al usuario.
   * @throws ForbiddenException si el usuario no tiene perfil de barbero.
   */
  async obtenerDisponibilidadDetalladaDelBarberoAutenticado(
    usuarioAutenticado: unknown,
    consulta: { servicioId?: number; fecha: string },
  ): Promise<DisponibilidadDetalladaResponseDto> {
    const usuarioId = this.resolverUsuarioId(usuarioAutenticado);
    const barbero =
      await this.barberosRepository.obtenerBarberoPorUsuarioId(usuarioId);

    if (!barbero) {
      throw new ForbiddenException(
        'El usuario autenticado no tiene un perfil de barbero asociado',
      );
    }

    return this.obtenerDisponibilidadDetallada({
      barberoId: barbero.id,
      servicioId: consulta.servicioId,
      fecha: consulta.fecha,
    });
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
   * Valida las precondiciones y precarga, una sola vez, los datos que consumen
   * todas las reglas: horario semanal del día, bloqueos activos y cierres
   * generales activos de la fecha.
   */
  private async construirContexto(
    consulta: ConsultaDisponibilidad,
  ): Promise<ContextoDisponibilidad> {
    const barbero = await this.barberosRepository.obtenerBarberoActivoPorId(
      consulta.barberoId,
    );

    if (!barbero) {
      throw new NotFoundException(
        `El barbero ${consulta.barberoId} no existe o no está activo`,
      );
    }

    if (consulta.servicioId !== undefined) {
      const servicio =
        await this.serviciosRepository.obtenerServicioActivoPorId(
          consulta.servicioId,
        );

      if (!servicio) {
        throw new NotFoundException(
          `El servicio ${consulta.servicioId} no existe o no está activo`,
        );
      }

      const asignado = await this.serviciosRepository.existeAsignacionBarbero(
        consulta.barberoId,
        consulta.servicioId,
      );

      if (!asignado) {
        throw new BadRequestException(
          `El servicio ${consulta.servicioId} no está asignado al barbero ${consulta.barberoId}`,
        );
      }
    }

    const fecha = this.validarFecha(consulta.fecha);
    const diaSemana = this.fechaBogotaService.obtenerDiaSemana(consulta.fecha);

    const franjasHorario =
      await this.horariosRepository.obtenerFranjasActivasPorBarberoYDia(
        consulta.barberoId,
        diaSemana,
      );

    const bloqueosActivos =
      await this.bloqueosRepository.listarActivosPorBarberoYFecha(
        consulta.barberoId,
        fecha,
      );

    const cierresActivos =
      await this.cierresRepository.obtenerActivosEnFecha(fecha);

    this.logger.log(
      `AUDIT: consulta disponibilidad barberoId=${consulta.barberoId} fecha=${consulta.fecha} servicioId=${consulta.servicioId ?? 'null'} franjasHorario=${franjasHorario.length} bloqueos=${bloqueosActivos.length} cierres=${cierresActivos.length}`,
    );

    return {
      barberoId: consulta.barberoId,
      fecha: consulta.fecha,
      diaSemana,
      franjasHorario,
      bloqueosActivos,
      cierresActivos,
    };
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
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoProducto,
  EstadoServicio,
  TipoDescuento,
  WeekDay,
} from '../../../../generated/prisma/enums';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { ProductoRepository } from '../../productos/repository/producto.repository';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';
import {
  DIAS_SEMANA_ORDEN,
  MENSAJE_DESCUENTO_APLICABLE,
  MENSAJE_DESCUENTO_INACTIVO,
  MENSAJE_DESCUENTO_NO_APLICABLE_DIA,
  MENSAJE_FECHA_CITA_PASADA,
  MENSAJE_FORMATO_FECHA_INVALIDO,
  MENSAJE_PRODUCTO_NO_DISPONIBLE,
  MENSAJE_SERVICIO_FECHA_REQUERIDA,
  MENSAJE_SERVICIO_NO_DISPONIBLE,
  MENSAJE_SIN_DESCUENTO_CONFIGURADO,
  normalizarDiasSemana,
} from '../descuentos.constants';
import {
  CondicionesDescuentoDto,
  DescuentoAplicableResponseDto,
  EstadoAplicabilidadDescuento,
} from '../dto/dto-respuesta/descuento-aplicable-response.dto';
import { DescuentosBatchResponseDto } from '../dto/dto-respuesta/descuentos-batch-response.dto';
import { EvaluarDescuentosBatchDto } from '../dto/dto-peticion/evaluar-descuentos-batch.dto';
import { DescuentoRepository } from '../repository/descuento.repository';

const DIAS_INGLES_A_WEEKDAY: Record<string, WeekDay> = {
  monday: WeekDay.MONDAY,
  tuesday: WeekDay.TUESDAY,
  wednesday: WeekDay.WEDNESDAY,
  thursday: WeekDay.THURSDAY,
  friday: WeekDay.FRIDAY,
  saturday: WeekDay.SATURDAY,
  sunday: WeekDay.SUNDAY,
};

/**
 * Servicio evaluador de descuentos aplicables en productos y servicios (HE-10-HU-05).
 *
 * Aplica las reglas de negocio de evaluación:
 * - Distingue estado configurado frente a aplicabilidad puntual (CA-06).
 * - Productos: evalúa contra el día actual en la zona horaria del tenant (CA-07).
 * - Servicios con fecha: evalúa contra el día de la cita en la zona horaria del tenant (CA-07).
 * - Servicios sin fecha: responde precio base y condiciones registradas sin precio final (CA-08).
 * - Cálculo verificable del precio final redondeado a dos decimales (CA-02, CA-05).
 * - Descuento inactivo o día no coincidente mantiene el precio original sin indicador (CA-03, CA-04).
 */
@Injectable()
export class DescuentoEvaluadorService {
  constructor(
    private readonly descuentoRepository: DescuentoRepository,
    private readonly productoRepository: ProductoRepository,
    private readonly serviciosRepository: ServiciosRepository,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  /**
   * Evalúa de forma eficiente en lote el descuento aplicable para un conjunto de productos y servicios.
   * Garantiza misma cardinalidad y orden alineado por índice con los IDs solicitados.
   */
  async evaluarBatch(
    dto: EvaluarDescuentosBatchDto,
  ): Promise<DescuentosBatchResponseDto> {
    const productos: DescuentoAplicableResponseDto[] = [];
    if (Array.isArray(dto.productoIds)) {
      for (const prodId of dto.productoIds) {
        try {
          const res = await this.evaluarProducto(prodId, true);
          productos.push(res);
        } catch (e) {
          if (e instanceof NotFoundException) {
            productos.push({
              tipo: TipoDescuento.PRODUCTO,
              elementoId: prodId,
              nombreElemento: '',
              estado: 'SIN_DESCUENTO',
              aplica: false,
              proximoDiaAplicable: null,
              diaEvaluado: null,
              zonaHoraria: '',
              porcentajeAplicado: null,
              precioOriginal: 0,
              precioFinal: 0,
              descuento: null,
              mensaje: MENSAJE_PRODUCTO_NO_DISPONIBLE,
            });
            continue;
          }
          throw e;
        }
      }
    }

    const servicios: DescuentoAplicableResponseDto[] = [];
    if (Array.isArray(dto.servicioIds)) {
      for (const servId of dto.servicioIds) {
        try {
          const res = await this.evaluarServicio(servId, dto.fecha, true);
          servicios.push(res);
        } catch (e) {
          if (e instanceof NotFoundException) {
            servicios.push({
              tipo: TipoDescuento.SERVICIO,
              elementoId: servId,
              nombreElemento: '',
              estado: 'SIN_DESCUENTO',
              aplica: false,
              proximoDiaAplicable: null,
              diaEvaluado: null,
              zonaHoraria: '',
              porcentajeAplicado: null,
              precioOriginal: 0,
              precioFinal: null,
              descuento: null,
              mensaje: MENSAJE_SERVICIO_NO_DISPONIBLE,
            });
            continue;
          }
          throw e;
        }
      }
    }

    return { productos, servicios };
  }

  /**
   * Evalúa el descuento aplicable a un producto para el momento actual.
   * La evaluación siempre se ejecuta en la zona horaria oficial del negocio.
   * Si permitirInactivo es true, evalúa productos inactivos devolviendo estado INACTIVO sin lanzar NotFoundException.
   */
  async evaluarProducto(
    productoId: number,
    permitirInactivo = false,
  ): Promise<DescuentoAplicableResponseDto> {
    const negocioId = this.aislamiento.negocioIdRequerido();
    const producto = await this.productoRepository.obtenerPorId(productoId);

    if (
      !producto ||
      (!permitirInactivo && producto.estado === EstadoProducto.INACTIVO)
    ) {
      throw new NotFoundException(MENSAJE_PRODUCTO_NO_DISPONIBLE);
    }

    const zonaHoraria =
      await this.descuentoRepository.obtenerZonaHorariaNegocio(negocioId);
    const diaActual = this.obtenerDiaActualEnZona(zonaHoraria);
    const precioOriginal = Number(producto.precio);
    const descuento = await this.descuentoRepository.buscarPorElemento(
      TipoDescuento.PRODUCTO,
      productoId,
    );

    const condiciones = descuento ? this.mapearCondiciones(descuento) : null;

    if (!descuento) {
      return {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: producto.id,
        nombreElemento: producto.nombre,
        estado: 'SIN_DESCUENTO' as EstadoAplicabilidadDescuento,
        aplica: false,
        proximoDiaAplicable: null,
        diaEvaluado: diaActual,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: precioOriginal,
        descuento: null,
        mensaje: MENSAJE_SIN_DESCUENTO_CONFIGURADO,
      };
    }

    if (!descuento.activo || producto.estado === EstadoProducto.INACTIVO) {
      return {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: producto.id,
        nombreElemento: producto.nombre,
        estado: 'INACTIVO' as EstadoAplicabilidadDescuento,
        aplica: false,
        proximoDiaAplicable: null,
        diaEvaluado: diaActual,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: precioOriginal,
        descuento: condiciones,
        mensaje: MENSAJE_DESCUENTO_INACTIVO,
      };
    }

    const diasConfigurados = normalizarDiasSemana(descuento.diasSemana);

    if (!diasConfigurados.includes(diaActual)) {
      return {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: producto.id,
        nombreElemento: producto.nombre,
        estado: 'NO_APLICA_DIA' as EstadoAplicabilidadDescuento,
        aplica: false,
        proximoDiaAplicable: this.calcularProximoDia(
          diaActual,
          diasConfigurados,
        ),
        diaEvaluado: diaActual,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: precioOriginal,
        descuento: condiciones,
        mensaje: MENSAJE_DESCUENTO_NO_APLICABLE_DIA,
      };
    }

    const porcentaje = Number(descuento.porcentaje);
    const precioFinal = this.calcularPrecioFinal(precioOriginal, porcentaje);

    return {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: producto.id,
      nombreElemento: producto.nombre,
      estado: 'APLICADO' as EstadoAplicabilidadDescuento,
      aplica: true,
      proximoDiaAplicable: null,
      diaEvaluado: diaActual,
      zonaHoraria,
      porcentajeAplicado: porcentaje,
      precioOriginal,
      precioFinal,
      descuento: condiciones,
      mensaje: MENSAJE_DESCUENTO_APLICABLE,
    };
  }

  /**
   * Evalúa el descuento aplicable a un servicio.
   * Si se indica `fecha` (YYYY-MM-DD), evalúa el día de la cita.
   * Si se omite `fecha`, devuelve el precio base y condiciones sin precio promocional final (CA-08).
   * Si permitirInactivo es true, no lanza NotFoundException si el servicio está inactivo.
   */
  async evaluarServicio(
    servicioId: number,
    fecha?: string,
    permitirInactivo = false,
  ): Promise<DescuentoAplicableResponseDto> {
    const negocioId = this.aislamiento.negocioIdRequerido();
    const servicio =
      await this.serviciosRepository.obtenerServicioPorId(servicioId);

    if (
      !servicio ||
      (!permitirInactivo && servicio.estado === EstadoServicio.INACTIVO)
    ) {
      throw new NotFoundException(MENSAJE_SERVICIO_NO_DISPONIBLE);
    }

    const zonaHoraria =
      await this.descuentoRepository.obtenerZonaHorariaNegocio(negocioId);
    const precioOriginal = Number(servicio.precio);
    const descuento = await this.descuentoRepository.buscarPorElemento(
      TipoDescuento.SERVICIO,
      servicioId,
    );

    const condiciones = descuento ? this.mapearCondiciones(descuento) : null;

    // CA-08: Servicio sin fecha de cita
    if (!fecha || fecha.trim() === '') {
      return {
        tipo: TipoDescuento.SERVICIO,
        elementoId: servicio.id,
        nombreElemento: servicio.nombre,
        estado: 'REQUIERE_FECHA' as EstadoAplicabilidadDescuento,
        aplica: false,
        proximoDiaAplicable: null,
        diaEvaluado: null,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: null,
        descuento: condiciones,
        mensaje: MENSAJE_SERVICIO_FECHA_REQUERIDA,
      };
    }

    // Validación de fecha (YYYY-MM-DD)
    const diaCita = this.obtenerDiaSemanaDeFecha(fecha, zonaHoraria);

    // Validación de fecha no pasada (H9)
    const fechaHoyEnZona = this.obtenerFechaHoyEnZona(zonaHoraria);
    if (fecha < fechaHoyEnZona) {
      throw new BadRequestException(MENSAJE_FECHA_CITA_PASADA);
    }

    if (!descuento) {
      return {
        tipo: TipoDescuento.SERVICIO,
        elementoId: servicio.id,
        nombreElemento: servicio.nombre,
        estado: 'SIN_DESCUENTO' as EstadoAplicabilidadDescuento,
        aplica: false,
        proximoDiaAplicable: null,
        diaEvaluado: diaCita,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: precioOriginal,
        descuento: null,
        mensaje: MENSAJE_SIN_DESCUENTO_CONFIGURADO,
      };
    }

    if (!descuento.activo || servicio.estado === EstadoServicio.INACTIVO) {
      return {
        tipo: TipoDescuento.SERVICIO,
        elementoId: servicio.id,
        nombreElemento: servicio.nombre,
        estado: 'INACTIVO' as EstadoAplicabilidadDescuento,
        aplica: false,
        proximoDiaAplicable: null,
        diaEvaluado: diaCita,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: precioOriginal,
        descuento: condiciones,
        mensaje: MENSAJE_DESCUENTO_INACTIVO,
      };
    }

    const diasConfigurados = normalizarDiasSemana(descuento.diasSemana);

    if (!diasConfigurados.includes(diaCita)) {
      return {
        tipo: TipoDescuento.SERVICIO,
        elementoId: servicio.id,
        nombreElemento: servicio.nombre,
        estado: 'NO_APLICA_DIA' as EstadoAplicabilidadDescuento,
        aplica: false,
        proximoDiaAplicable: this.calcularProximoDia(diaCita, diasConfigurados),
        diaEvaluado: diaCita,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: precioOriginal,
        descuento: condiciones,
        mensaje: MENSAJE_DESCUENTO_NO_APLICABLE_DIA,
      };
    }

    const porcentaje = Number(descuento.porcentaje);
    const precioFinal = this.calcularPrecioFinal(precioOriginal, porcentaje);

    return {
      tipo: TipoDescuento.SERVICIO,
      elementoId: servicio.id,
      nombreElemento: servicio.nombre,
      estado: 'APLICADO' as EstadoAplicabilidadDescuento,
      aplica: true,
      proximoDiaAplicable: null,
      diaEvaluado: diaCita,
      zonaHoraria,
      porcentajeAplicado: porcentaje,
      precioOriginal,
      precioFinal,
      descuento: condiciones,
      mensaje: MENSAJE_DESCUENTO_APLICABLE,
    };
  }

  /** Calcula el precio final redondeado a 2 decimales: precioOriginal * (1 - pct/100). */
  calcularPrecioFinal(precioOriginal: number, porcentaje: number): number {
    const factor = (100 - porcentaje) / 100;
    const finalCalculado = precioOriginal * factor;
    return Math.round(finalCalculado * 100) / 100;
  }

  /** Determina el día de la semana actual en la zona horaria del negocio. */
  obtenerDiaActualEnZona(zonaHoraria: string): WeekDay {
    return this.resolverDiaSemana(new Date(), zonaHoraria);
  }

  /** Devuelve la fecha de hoy en formato YYYY-MM-DD en la zona horaria indicada. */
  obtenerFechaHoyEnZona(zonaHoraria: string): string {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zonaHoraria,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    }
  }

  /**
   * Calcula el próximo día de la semana en que aplicará el descuento a partir del día actual
   * recorriendo el ciclo semanal canónico.
   */
  calcularProximoDia(
    diaActual: WeekDay,
    diasConfigurados: WeekDay[],
  ): WeekDay | null {
    if (diasConfigurados.length === 0) {
      return null;
    }
    const indiceActual = DIAS_SEMANA_ORDEN.indexOf(diaActual);
    if (indiceActual === -1) {
      return diasConfigurados[0];
    }
    for (let offset = 1; offset <= 7; offset++) {
      const siguiente = DIAS_SEMANA_ORDEN[(indiceActual + offset) % 7];
      if (diasConfigurados.includes(siguiente)) {
        return siguiente;
      }
    }
    return null;
  }

  /** Interpreta la fecha YYYY-MM-DD en la zona horaria y devuelve su WeekDay canónico. */
  obtenerDiaSemanaDeFecha(fecha: string, zonaHoraria: string): WeekDay {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(fecha)) {
      throw new BadRequestException(MENSAJE_FORMATO_FECHA_INVALIDO);
    }

    const [anioStr, mesStr, diaStr] = fecha.split('-');
    const anio = Number(anioStr);
    const mes = Number(mesStr);
    const dia = Number(diaStr);

    const fechaUtc = new Date(Date.UTC(anio, mes - 1, dia, 12, 0, 0));
    if (
      fechaUtc.getUTCFullYear() !== anio ||
      fechaUtc.getUTCMonth() !== mes - 1 ||
      fechaUtc.getUTCDate() !== dia
    ) {
      throw new BadRequestException(MENSAJE_FORMATO_FECHA_INVALIDO);
    }

    return this.resolverDiaSemana(fechaUtc, zonaHoraria);
  }

  private resolverDiaSemana(date: Date, zonaHoraria: string): WeekDay {
    let diaNombre: string;
    try {
      diaNombre = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: zonaHoraria,
      })
        .format(date)
        .toLowerCase();
    } catch {
      diaNombre = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: 'America/Bogota',
      })
        .format(date)
        .toLowerCase();
    }

    const weekDay = DIAS_INGLES_A_WEEKDAY[diaNombre];
    if (!weekDay) {
      throw new BadRequestException('Error al resolver el día de la semana');
    }

    return weekDay;
  }

  private mapearCondiciones(descuento: {
    id: number;
    activo: boolean;
    porcentaje: unknown;
    diasSemana: unknown;
  }): CondicionesDescuentoDto {
    return {
      id: descuento.id,
      activo: descuento.activo,
      porcentaje: Number(descuento.porcentaje),
      diasSemana: normalizarDiasSemana(descuento.diasSemana),
    };
  }
}

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
  MENSAJE_DESCUENTO_APLICABLE,
  MENSAJE_DESCUENTO_INACTIVO,
  MENSAJE_DESCUENTO_NO_APLICABLE_DIA,
  MENSAJE_FORMATO_FECHA_INVALIDO,
  MENSAJE_PRODUCTO_NO_DISPONIBLE,
  MENSAJE_SERVICIO_FECHA_REQUERIDA,
  MENSAJE_SERVICIO_NO_DISPONIBLE,
  MENSAJE_SIN_DESCUENTO_CONFIGURADO,
} from '../descuentos.constants';
import {
  CondicionesDescuentoDto,
  DescuentoAplicableResponseDto,
} from '../dto/dto-respuesta/descuento-aplicable-response.dto';
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
   * Evalúa el descuento aplicable a un producto para el momento actual.
   * La evaluación siempre se ejecuta en la zona horaria oficial del negocio.
   */
  async evaluarProducto(
    productoId: number,
  ): Promise<DescuentoAplicableResponseDto> {
    const negocioId = this.aislamiento.negocioIdRequerido();
    const producto = await this.productoRepository.obtenerPorId(productoId);

    if (!producto || producto.estado === EstadoProducto.INACTIVO) {
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
        aplica: false,
        diaEvaluado: diaActual,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: precioOriginal,
        descuento: null,
        mensaje: MENSAJE_SIN_DESCUENTO_CONFIGURADO,
      };
    }

    if (!descuento.activo) {
      return {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: producto.id,
        nombreElemento: producto.nombre,
        aplica: false,
        diaEvaluado: diaActual,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: precioOriginal,
        descuento: condiciones,
        mensaje: MENSAJE_DESCUENTO_INACTIVO,
      };
    }

    const diasConfigurados = Array.isArray(descuento.diasSemana)
      ? (descuento.diasSemana as WeekDay[])
      : [];

    if (!diasConfigurados.includes(diaActual)) {
      return {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: producto.id,
        nombreElemento: producto.nombre,
        aplica: false,
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
      aplica: true,
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
   */
  async evaluarServicio(
    servicioId: number,
    fecha?: string,
  ): Promise<DescuentoAplicableResponseDto> {
    const negocioId = this.aislamiento.negocioIdRequerido();
    const servicio =
      await this.serviciosRepository.obtenerServicioPorId(servicioId);

    if (!servicio || servicio.estado === EstadoServicio.INACTIVO) {
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
        aplica: false,
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

    if (!descuento) {
      return {
        tipo: TipoDescuento.SERVICIO,
        elementoId: servicio.id,
        nombreElemento: servicio.nombre,
        aplica: false,
        diaEvaluado: diaCita,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: precioOriginal,
        descuento: null,
        mensaje: MENSAJE_SIN_DESCUENTO_CONFIGURADO,
      };
    }

    if (!descuento.activo) {
      return {
        tipo: TipoDescuento.SERVICIO,
        elementoId: servicio.id,
        nombreElemento: servicio.nombre,
        aplica: false,
        diaEvaluado: diaCita,
        zonaHoraria,
        porcentajeAplicado: null,
        precioOriginal,
        precioFinal: precioOriginal,
        descuento: condiciones,
        mensaje: MENSAJE_DESCUENTO_INACTIVO,
      };
    }

    const diasConfigurados = Array.isArray(descuento.diasSemana)
      ? (descuento.diasSemana as WeekDay[])
      : [];

    if (!diasConfigurados.includes(diaCita)) {
      return {
        tipo: TipoDescuento.SERVICIO,
        elementoId: servicio.id,
        nombreElemento: servicio.nombre,
        aplica: false,
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
      aplica: true,
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
      diasSemana: Array.isArray(descuento.diasSemana)
        ? (descuento.diasSemana as WeekDay[])
        : [],
    };
  }
}

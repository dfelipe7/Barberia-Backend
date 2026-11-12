import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Descuento } from '../../../../generated/prisma/client';
import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { ProductoRepository } from '../../productos/repository/producto.repository';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';
import {
  DIAS_SEMANA_ORDEN,
  MENSAJE_CONFIGURACION_INVALIDA_ACTIVACION,
  MENSAJE_DESCUENTO_DUPLICADO,
  MENSAJE_DESCUENTO_NO_ENCONTRADO,
  MENSAJE_DIAS_REQUERIDOS,
  MENSAJE_ELEMENTO_NO_DISPONIBLE,
  MENSAJE_PORCENTAJE_INVALIDO,
  MENSAJE_SIN_CAMBIOS_DESCUENTO,
  PORCENTAJE_MAXIMO_DESCUENTO,
  PORCENTAJE_MINIMO_DESCUENTO,
} from '../descuentos.constants';
import { ActualizarDescuentoDto } from '../dto/dto-peticion/actualizar-descuento.dto';
import { CrearDescuentoDto } from '../dto/dto-peticion/crear-descuento.dto';
import { DescuentoResponseDto } from '../dto/dto-respuesta/descuento-response.dto';
import {
  CambiosDescuento,
  DescuentoRepository,
} from '../repository/descuento.repository';

/** Datos ya validados que el repositorio persiste. */
export interface DatosDescuento {
  tipo: TipoDescuento;
  productoId: number | null;
  servicioId: number | null;
  porcentaje: number;
  diasSemana: WeekDay[];
}

/**
 * Reglas de creación de descuentos (HE-10-HU-02).
 *
 * La creación NO activa el descuento y NO evalúa precios: solo registra la
 * configuración. La aplicación del porcentaje corresponde a la consulta de
 * catálogo/reserva.
 */
@Injectable()
export class DescuentoService {
  constructor(
    private readonly descuentoRepository: DescuentoRepository,
    private readonly productoRepository: ProductoRepository,
    private readonly serviciosRepository: ServiciosRepository,
  ) {}

  /** Devuelve la lista de descuentos del negocio activo (HE-10-HU-01). */
  async listar(): Promise<DescuentoResponseDto[]> {
    const descuentos = await this.descuentoRepository.listar();

    return descuentos.map((d) => {
      const nombre = d.producto?.nombre ?? d.servicio?.nombre ?? '';
      return this.mapear(d, nombre);
    });
  }

  async crear(dto: CrearDescuentoDto): Promise<DescuentoResponseDto> {
    const diasSemana = this.normalizarDias(dto.diasSemana);
    this.validarPorcentaje(dto.porcentaje);

    const elemento = await this.obtenerElemento(dto.tipo, dto.elementoId);
    const existente = await this.descuentoRepository.buscarPorElemento(
      dto.tipo,
      dto.elementoId,
    );

    if (existente) {
      throw new ConflictException(MENSAJE_DESCUENTO_DUPLICADO);
    }

    const descuento = await this.descuentoRepository.crear({
      tipo: dto.tipo,
      productoId: dto.tipo === TipoDescuento.PRODUCTO ? dto.elementoId : null,
      servicioId: dto.tipo === TipoDescuento.SERVICIO ? dto.elementoId : null,
      porcentaje: dto.porcentaje,
      diasSemana,
    });

    return this.mapear(descuento, elemento.nombre);
  }

  async obtenerPorId(id: number): Promise<DescuentoResponseDto> {
    const descuento = await this.descuentoRepository.obtenerPorId(id);

    if (!descuento) {
      throw new NotFoundException(MENSAJE_DESCUENTO_NO_ENCONTRADO);
    }

    const nombreElemento =
      descuento.producto?.nombre ?? descuento.servicio?.nombre ?? '';

    return this.mapear(descuento, nombreElemento);
  }

  async actualizar(
    id: number,
    dto: ActualizarDescuentoDto,
  ): Promise<DescuentoResponseDto> {
    if (dto.porcentaje === undefined && dto.diasSemana === undefined) {
      throw new BadRequestException(MENSAJE_SIN_CAMBIOS_DESCUENTO);
    }

    if (dto.porcentaje !== undefined) {
      this.validarPorcentaje(dto.porcentaje);
    }

    const diasSemana =
      dto.diasSemana !== undefined
        ? this.normalizarDias(dto.diasSemana)
        : undefined;

    const datos: CambiosDescuento = {
      ...(dto.porcentaje !== undefined ? { porcentaje: dto.porcentaje } : {}),
      ...(diasSemana !== undefined ? { diasSemana } : {}),
    };

    const descuento = await this.descuentoRepository.actualizar(id, datos);
    const nombreElemento =
      descuento.producto?.nombre ?? descuento.servicio?.nombre ?? '';

    return this.mapear(descuento, nombreElemento);
  }

  async cambiarEstado(
    id: number,
    activo: boolean,
  ): Promise<DescuentoResponseDto> {
    const existente = await this.descuentoRepository.obtenerPorId(id);
    if (!existente) {
      throw new NotFoundException(MENSAJE_DESCUENTO_NO_ENCONTRADO);
    }

    if (activo) {
      const porcentaje = Number(existente.porcentaje);
      if (
        !Number.isFinite(porcentaje) ||
        porcentaje < PORCENTAJE_MINIMO_DESCUENTO ||
        porcentaje > PORCENTAJE_MAXIMO_DESCUENTO ||
        Math.abs(porcentaje * 100 - Math.round(porcentaje * 100)) > 1e-9 ||
        !Array.isArray(existente.diasSemana) ||
        existente.diasSemana.length === 0 ||
        (!existente.producto && !existente.servicio)
      ) {
        throw new BadRequestException(
          MENSAJE_CONFIGURACION_INVALIDA_ACTIVACION,
        );
      }
    }

    const nombreElemento =
      existente.producto?.nombre ?? existente.servicio?.nombre ?? '';

    if (existente.activo === activo) {
      return this.mapear(existente, nombreElemento);
    }

    const actualizado = await this.descuentoRepository.cambiarEstado(
      id,
      activo,
    );
    const nombreActualizado =
      actualizado.producto?.nombre ?? actualizado.servicio?.nombre ?? '';

    return this.mapear(actualizado, nombreActualizado);
  }

  private async obtenerElemento(
    tipo: TipoDescuento,
    elementoId: number,
  ): Promise<{ id: number; nombre: string }> {
    if (tipo === TipoDescuento.PRODUCTO) {
      const producto = await this.productoRepository.obtenerPorId(elementoId);

      if (!producto) {
        throw new NotFoundException(MENSAJE_ELEMENTO_NO_DISPONIBLE);
      }

      return { id: producto.id, nombre: producto.nombre };
    }

    if (tipo === TipoDescuento.SERVICIO) {
      const servicio =
        await this.serviciosRepository.obtenerServicioPorId(elementoId);

      if (!servicio) {
        throw new NotFoundException(MENSAJE_ELEMENTO_NO_DISPONIBLE);
      }

      return { id: servicio.id, nombre: servicio.nombre };
    }

    throw new BadRequestException('Tipo de descuento inválido');
  }

  private normalizarDias(dias: WeekDay[]): WeekDay[] {
    if (!Array.isArray(dias) || dias.length === 0) {
      throw new BadRequestException(MENSAJE_DIAS_REQUERIDOS);
    }

    const unicos = new Set(dias);
    const invalidos = [...unicos].filter(
      (dia) => !DIAS_SEMANA_ORDEN.includes(dia),
    );

    if (invalidos.length > 0) {
      throw new BadRequestException(MENSAJE_DIAS_REQUERIDOS);
    }

    return DIAS_SEMANA_ORDEN.filter((dia) => unicos.has(dia));
  }

  private validarPorcentaje(porcentaje: number): void {
    if (
      !Number.isFinite(porcentaje) ||
      porcentaje < PORCENTAJE_MINIMO_DESCUENTO ||
      porcentaje > PORCENTAJE_MAXIMO_DESCUENTO
    ) {
      throw new BadRequestException(MENSAJE_PORCENTAJE_INVALIDO);
    }

    const centesimas = porcentaje * 100;
    if (Math.abs(centesimas - Math.round(centesimas)) > 1e-9) {
      throw new BadRequestException(MENSAJE_PORCENTAJE_INVALIDO);
    }
  }

  private mapear(
    descuento: Descuento,
    nombreElemento: string,
  ): DescuentoResponseDto {
    return {
      id: descuento.id,
      tipo: descuento.tipo,
      elemento: {
        id: descuento.productoId ?? descuento.servicioId!,
        nombre: nombreElemento,
      },
      porcentaje: Number(descuento.porcentaje),
      diasSemana: Array.isArray(descuento.diasSemana)
        ? (descuento.diasSemana as WeekDay[])
        : [],
      activo: descuento.activo,
      creadoEn: descuento.creadoEn,
      actualizadoEn: descuento.actualizadoEn,
    };
  }
}

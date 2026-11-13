import { Injectable } from '@nestjs/common';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import {
  MENSAJE_DESCUENTO_ACTIVADO,
  MENSAJE_DESCUENTO_ACTUALIZADO,
  MENSAJE_DESCUENTO_CREADO,
  MENSAJE_DESCUENTO_DESACTIVADO,
  MENSAJE_DESCUENTOS_LISTADOS,
  MENSAJE_SIN_DESCUENTOS,
} from '../descuentos.constants';
import { ActualizarDescuentoDto } from '../dto/dto-peticion/actualizar-descuento.dto';
import { CambiarEstadoDescuentoDto } from '../dto/dto-peticion/cambiar-estado-descuento.dto';
import { CrearDescuentoDto } from '../dto/dto-peticion/crear-descuento.dto';
import { EvaluarDescuentosBatchDto } from '../dto/dto-peticion/evaluar-descuentos-batch.dto';
import { DescuentoAplicableResponseDto } from '../dto/dto-respuesta/descuento-aplicable-response.dto';
import { DescuentosBatchResponseDto } from '../dto/dto-respuesta/descuentos-batch-response.dto';
import {
  DescuentoActualizadoResponseDto,
  DescuentoCreadoResponseDto,
  DescuentoEstadoResponseDto,
  DescuentoResponseDto,
  ListaDescuentosResponseDto,
} from '../dto/dto-respuesta/descuento-response.dto';
import { DescuentoEvaluadorService } from '../service/descuento-evaluador.service';
import { DescuentoService } from '../service/descuento.service';

/** Punto único de entrada del módulo de descuentos. */
@Injectable()
export class DescuentosFacade {
  constructor(
    private readonly descuentoService: DescuentoService,
    private readonly descuentoEvaluadorService: DescuentoEvaluadorService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  /** Lista todos los descuentos configurados en el negocio activo (HE-10-HU-01). */
  async listar(): Promise<ListaDescuentosResponseDto> {
    this.aislamiento.negocioIdRequerido();
    const descuentos = await this.descuentoService.listar();
    const mensaje =
      descuentos.length > 0
        ? MENSAJE_DESCUENTOS_LISTADOS
        : MENSAJE_SIN_DESCUENTOS;

    return { mensaje, descuentos, total: descuentos.length };
  }

  /**
   * Evalúa el descuento aplicable a un producto en el momento actual (HE-10-HU-05).
   */
  async evaluarDescuentoProducto(
    productoId: number,
    permitirInactivo?: boolean,
  ): Promise<DescuentoAplicableResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return permitirInactivo !== undefined
      ? this.descuentoEvaluadorService.evaluarProducto(
          productoId,
          permitirInactivo,
        )
      : this.descuentoEvaluadorService.evaluarProducto(productoId);
  }

  /**
   * Evalúa el descuento aplicable a un servicio para una fecha dada (HE-10-HU-05).
   */
  async evaluarDescuentoServicio(
    servicioId: number,
    fecha?: string,
    permitirInactivo?: boolean,
  ): Promise<DescuentoAplicableResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return permitirInactivo !== undefined
      ? this.descuentoEvaluadorService.evaluarServicio(
          servicioId,
          fecha,
          permitirInactivo,
        )
      : this.descuentoEvaluadorService.evaluarServicio(servicioId, fecha);
  }

  /**
   * Evalúa de forma eficiente en lote el descuento de múltiples productos y servicios (H3).
   */
  async evaluarBatch(
    dto: EvaluarDescuentosBatchDto,
  ): Promise<DescuentosBatchResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return this.descuentoEvaluadorService.evaluarBatch(dto);
  }

  async crear(dto: CrearDescuentoDto): Promise<DescuentoCreadoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    const descuento = await this.descuentoService.crear(dto);

    return {
      mensaje: MENSAJE_DESCUENTO_CREADO,
      descuento,
    };
  }

  async obtenerPorId(id: number): Promise<DescuentoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    return this.descuentoService.obtenerPorId(id);
  }

  async actualizar(
    id: number,
    dto: ActualizarDescuentoDto,
  ): Promise<DescuentoActualizadoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    const descuento = await this.descuentoService.actualizar(id, dto);

    return {
      mensaje: MENSAJE_DESCUENTO_ACTUALIZADO,
      descuento,
    };
  }

  async cambiarEstado(
    id: number,
    dto: CambiarEstadoDescuentoDto,
  ): Promise<DescuentoEstadoResponseDto> {
    this.aislamiento.negocioIdRequerido();
    const descuento = await this.descuentoService.cambiarEstado(id, dto.activo);
    const mensaje = dto.activo
      ? MENSAJE_DESCUENTO_ACTIVADO
      : MENSAJE_DESCUENTO_DESACTIVADO;

    return {
      mensaje,
      descuento,
    };
  }
}

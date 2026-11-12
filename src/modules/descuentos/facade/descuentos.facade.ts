import { Injectable } from '@nestjs/common';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import {
  MENSAJE_DESCUENTO_ACTIVADO,
  MENSAJE_DESCUENTO_ACTUALIZADO,
  MENSAJE_DESCUENTO_CREADO,
  MENSAJE_DESCUENTO_DESACTIVADO,
} from '../descuentos.constants';
import { ActualizarDescuentoDto } from '../dto/dto-peticion/actualizar-descuento.dto';
import { CambiarEstadoDescuentoDto } from '../dto/dto-peticion/cambiar-estado-descuento.dto';
import { CrearDescuentoDto } from '../dto/dto-peticion/crear-descuento.dto';
import {
  DescuentoActualizadoResponseDto,
  DescuentoCreadoResponseDto,
  DescuentoEstadoResponseDto,
  DescuentoResponseDto,
} from '../dto/dto-respuesta/descuento-response.dto';
import { DescuentoService } from '../service/descuento.service';

/** Punto único de entrada del módulo de descuentos. */
@Injectable()
export class DescuentosFacade {
  constructor(
    private readonly descuentoService: DescuentoService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

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

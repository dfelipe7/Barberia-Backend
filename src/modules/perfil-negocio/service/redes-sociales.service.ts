import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TipoRedSocial } from '../../../../generated/prisma/enums';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { ContextoNegocio } from '../../negocios/negocio-almacenamiento';
import { CrearRedSocialDto } from '../dto/dto-peticion/crear-red-social.dto';
import { ActualizarRedSocialDto } from '../dto/dto-peticion/actualizar-red-social.dto';
import { RedSocialResponseDto } from '../dto/dto-respuesta/red-social.response.dto';
import {
  RedSocialRegistro,
  RedesSocialesRepository,
} from '../repository/redes-sociales.repository';

/** Nombres canónicos de las redes predefinidas. */
const NOMBRES_CANONICOS: Partial<Record<TipoRedSocial, string>> = {
  [TipoRedSocial.TIKTOK]: 'TikTok',
  [TipoRedSocial.FACEBOOK]: 'Facebook',
  [TipoRedSocial.INSTAGRAM]: 'Instagram',
  [TipoRedSocial.WHATSAPP]: 'WhatsApp',
};

/**
 * Lógica de negocio para las redes sociales del perfil del negocio (Fase 18).
 *
 * AISLAMIENTO
 * -----------
 * El negocio es SIEMPRE el del CONTEXTO de la petición. Ningún método acepta
 * un `negocioId` desde el exterior: lo resuelve internamente a través de
 * `contextoRequerido()`.
 */
@Injectable()
export class RedesSocialesService {
  constructor(
    private readonly redesRepository: RedesSocialesRepository,
    private readonly contextoService: NegocioContextoService,
  ) {}

  /**
   * Lista las redes sociales ACTIVAS del negocio del contexto.
   */
  async listar(incluirInactivas = false): Promise<RedSocialResponseDto[]> {
    const contexto = this.contextoRequerido();
    const filas = incluirInactivas
      ? await this.redesRepository.listarPorNegocio(contexto.id, true)
      : await this.redesRepository.listarPorNegocio(contexto.id);

    return filas.map((f) => this.mapear(f));
  }

  /**
   * Reemplaza el conjunto de redes sociales del negocio del contexto.
   *
   * Las redes que no aparezcan en la lista se desactivan (soft-delete).
   * Las que aparecen se crean o actualizan.
   *
   * Validaciones:
   * - Tipo OTRO requiere `nombre`.
   * - Solo un predefinido de cada tipo (la unicidad la garantiza la BD, pero
   *   se valida aquí para dar un mensaje amigable).
   * - Las redes predefinidas usan su nombre canónico, ignorando el enviado.
   */
  async reemplazar(dtos: CrearRedSocialDto[]): Promise<RedSocialResponseDto[]> {
    const contexto = this.contextoRequerido();

    // Validaciones previas
    const tiposUsados = new Set<TipoRedSocial>();
    for (const dto of dtos) {
      if (dto.tipo === TipoRedSocial.OTRO) {
        if (!dto.nombre || dto.nombre.trim().length === 0) {
          throw new BadRequestException(
            'El nombre es obligatorio para redes de tipo OTRO.',
          );
        }
      } else {
        if (tiposUsados.has(dto.tipo)) {
          throw new BadRequestException(
            `Solo puede haber una red de tipo ${dto.tipo} por negocio.`,
          );
        }
        tiposUsados.add(dto.tipo);
      }
    }

    const redes = dtos.map((dto) => ({
      tipo: dto.tipo,
      nombre:
        dto.tipo === TipoRedSocial.OTRO
          ? dto.nombre!.trim()
          : (NOMBRES_CANONICOS[dto.tipo] ?? dto.tipo),
      url: dto.url,
      orden: dto.orden ?? 0,
    }));

    const filas = await this.redesRepository.reemplazar(contexto.id, redes);

    return filas.map((f) => this.mapear(f));
  }

  /**
   * Actualiza parcialmente UNA red social (url, nombre u orden).
   *
   * - Solo las redes de tipo OTRO pueden cambiar de nombre.
   * - Al renombrar una OTRO se verifica que no colisione con otra activa.
   * - Si no se envía ningún campo, devuelve 400.
   */
  async actualizar(
    id: number,
    dto: ActualizarRedSocialDto,
  ): Promise<RedSocialResponseDto> {
    const contexto = this.contextoRequerido();
    const actual = await this.redesRepository.obtenerPorId(contexto.id, id);

    if (!actual) {
      throw new NotFoundException('La red social no existe en este negocio.');
    }

    if (dto.nombre !== undefined && actual.tipo !== TipoRedSocial.OTRO) {
      throw new BadRequestException(
        'Solo las redes de tipo OTRO pueden cambiar de nombre.',
      );
    }

    const datos: { url?: string; nombre?: string; orden?: number } = {};
    if (dto.url !== undefined) datos.url = dto.url;
    if (dto.nombre !== undefined) datos.nombre = dto.nombre.trim();
    if (dto.orden !== undefined) datos.orden = dto.orden;

    if (Object.keys(datos).length === 0) {
      throw new BadRequestException(
        'Debe indicar al menos un campo (url, nombre u orden).',
      );
    }

    // Si cambia el nombre de una red OTRO, validar colisión con otra OTRO activa.
    if (
      datos.nombre !== undefined &&
      datos.nombre.toLowerCase() !== actual.nombre.toLowerCase()
    ) {
      const colision = await this.redesRepository.existeOtraActivaConMismaClave(
        contexto.id,
        id,
        actual.tipo,
        datos.nombre,
      );
      if (colision) {
        throw new ConflictException(
          `Ya hay otra red social de tipo OTRO con el nombre '${datos.nombre}'.`,
        );
      }
    }

    const fila = await this.redesRepository.actualizar(contexto.id, id, datos);

    return this.mapear(fila);
  }

  /**
   * Soft-delete: marca la red como inactiva.
   * Idempotente: si ya está desactivada, se devuelve tal cual.
   */
  /**
   * Eliminación definitiva de la red social.
   */
  async eliminarFisico(id: number): Promise<RedSocialResponseDto> {
    const contexto = this.contextoRequerido();
    const existente = await this.redesRepository.obtenerPorId(contexto.id, id);
    if (!existente) {
      throw new NotFoundException(
        `La red social con id ${id} no existe en este negocio.`,
      );
    }

    const eliminada = await this.redesRepository.eliminarFisico(contexto.id, id);
    return this.mapear(eliminada);
  }

  async desactivar(id: number): Promise<RedSocialResponseDto> {
    const contexto = this.contextoRequerido();
    const actual = await this.redesRepository.obtenerPorId(contexto.id, id);

    if (!actual) {
      throw new NotFoundException('La red social no existe en este negocio.');
    }

    // Idempotente: si ya está desactivada, se devuelve tal cual.
    if (!actual.activo) {
      return this.mapear(actual);
    }

    const fila = await this.redesRepository.desactivar(contexto.id, id);

    return this.mapear(fila);
  }

  /**
   * Reactiva una red social: `activo = true`.
   * Idempotente: si ya está activa, se devuelve tal cual.
   */
  async activar(id: number): Promise<RedSocialResponseDto> {
    const contexto = this.contextoRequerido();
    const actual = await this.redesRepository.obtenerPorId(contexto.id, id);

    if (!actual) {
      throw new NotFoundException('La red social no existe en este negocio.');
    }

    if (actual.activo) {
      return this.mapear(actual);
    }

    // Reactivar puede chocar con una activa del mismo (tipo, nombre).
    const colision = await this.redesRepository.existeOtraActivaConMismaClave(
      contexto.id,
      id,
      actual.tipo,
      actual.nombre,
    );
    if (colision) {
      throw new ConflictException(
        `Ya hay una red social activa de tipo ${actual.tipo} con el nombre '${actual.nombre}'.`,
      );
    }

    const fila = await this.redesRepository.activar(contexto.id, id);

    return this.mapear(fila);
  }

  /** Convierte una fila del repositorio en el DTO de respuesta. */
  private mapear(fila: RedSocialRegistro): RedSocialResponseDto {
    return {
      id: fila.id,
      tipo: fila.tipo,
      nombre: fila.nombre,
      url: fila.url,
      orden: fila.orden,
      activo: fila.activo,
    };
  }

  /**
   * Contexto de negocio de la petición.
   *
   * @throws ForbiddenException si no hay contexto de negocio autorizado.
   */
  private contextoRequerido(): ContextoNegocio {
    const contexto = this.contextoService.obtenerContexto();

    if (!contexto) {
      throw new ForbiddenException(
        'La consulta de redes sociales requiere un contexto de negocio autorizado',
      );
    }

    return contexto;
  }
}

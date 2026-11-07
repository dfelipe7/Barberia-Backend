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
   * Obtiene la lista de perfiles y canales sociales del negocio activo.
   *
   * @remarks
   * Por defecto aplica filtrado de visibilidad pública (`activo = true`) para renderizar en portada.
   * Si se invoca desde el panel administrativo (`incluirInactivas = true`), expone también
   * los canales pausados para permitir su reactivación sin reescribir la URL.
   *
   * @param incluirInactivas - Si es true, retorna tanto redes activas como pausadas
   * @returns Promesa con el arreglo de redes sociales mapeadas al DTO de respuesta
   * @throws {ForbiddenException} Si la petición carece de contexto multitenant válido
   */
  async listar(incluirInactivas = false): Promise<RedSocialResponseDto[]> {
    const contexto = this.contextoRequerido();
    const filas = incluirInactivas
      ? await this.redesRepository.listarPorNegocio(contexto.id, true)
      : await this.redesRepository.listarPorNegocio(contexto.id);

    return filas.map((f) => this.mapear(f));
  }

  /**
   * Reemplaza atómicamente el catálogo de redes sociales de la sede.
   *
   * @remarks
   * Aplica estrategia diferencial: las redes ausentes en el payload pasan a soft-delete
   * para conservar analítica de enlaces. Las plataformas canónicas (Instagram, WhatsApp,
   * Facebook, TikTok) fuerzan su nombre oficial en servidor.
   *
   * @param dtos - Catálogo completo de redes que quedarán vinculadas a la sede
   * @returns Lista de redes resultantes mapeadas al DTO de respuesta
   * @throws {BadRequestException} Si un tipo OTRO carece de nombre o hay duplicados del mismo tipo predefinido
   * @throws {ForbiddenException} Si la petición carece de contexto multitenant
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
      if (!dto.url?.startsWith('https://')) {
        throw new BadRequestException('La URL debe ser válida y usar HTTPS.');
      }
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
   * Actualiza los datos de un canal social existente de la sede.
   *
   * @remarks
   * Solo los canales de tipo OTRO permiten modificar su nombre visible.
   * Las plataformas oficiales (Instagram, Facebook, etc.) mantienen su nombre inmutable
   * para coherencia de marca. Al renombrar un tipo OTRO, se valida que no colisione
   * con otro canal activo del mismo nombre en esta sede.
   *
   * @param id - Identificador numérico único de la red social
   * @param dto - Campos parciales a actualizar (url, nombre, orden)
   * @returns Red social actualizada
   * @throws {NotFoundException} Si la red no existe o pertenece a otro negocio (aislamiento)
   * @throws {BadRequestException} Si se intenta renombrar una plataforma canónica o si el payload está vacío
   * @throws {ConflictException} Si el nuevo nombre colisiona con otra red activa de tipo OTRO
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
   * Elimina de forma definitiva e irrecuperable una red social de la base de datos (Hard-Delete).
   *
   * @remarks
   * Esta acción destruye físicamente el registro en MySQL. Se invoca únicamente cuando el
   * administrador confirma la acción en el modal de confirmación `ConfirmDialog`.
   *
   * @param id - Identificador de la red a eliminar
   * @returns Datos de la red social antes de su destrucción
   * @throws {NotFoundException} Si la red no existe o pertenece a otro negocio
   * @throws {ForbiddenException} Si la petición carece de contexto multitenant
   */
  async eliminarFisico(id: number): Promise<RedSocialResponseDto> {
    const contexto = this.contextoRequerido();
    const existente = await this.redesRepository.obtenerPorId(contexto.id, id);
    if (!existente) {
      throw new NotFoundException(
        `La red social con id ${id} no existe en este negocio.`,
      );
    }

    const eliminada = await this.redesRepository.eliminarFisico(
      contexto.id,
      id,
    );
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
   * Reactiva un canal social previamente pausado (`activo = true`).
   *
   * @remarks
   * Valida preventivamente contra colisiones de clave única compuesta: si mientras estaba pausada
   * se creó otra red con el mismo tipo y nombre, la reactivación se bloquea para evitar violaciones
   * de unicidad a nivel de motor de base de datos.
   *
   * @param id - Identificador de la red social a reanudar
   * @returns Red social reactivada con visibilidad pública
   * @throws {NotFoundException} Si la red no existe en el contexto activo
   * @throws {ConflictException} Si existe otra red activa con la misma clave compuesta (tipo, nombre)
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

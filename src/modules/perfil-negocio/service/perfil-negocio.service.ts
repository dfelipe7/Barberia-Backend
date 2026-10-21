import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { ContextoNegocio } from '../../negocios/negocio-almacenamiento';
import { NegociosRepository } from '../../negocios/repository/negocios.repository';
import {
  PerfilNegocioRegistro,
  PerfilNegocioRepository,
} from '../repository/perfil-negocio.repository';
import { derivarUrlMapa } from '../perfil-negocio.constants';
import { ActualizarPerfilNegocioDto } from '../dto/dto-peticion/actualizar-perfil-negocio.dto';
import { ActualizarReferenciasPerfilDto } from '../dto/dto-peticion/actualizar-perfil-negocio.dto';
import { PerfilNegocioGestionResponseDto } from '../dto/dto-respuesta/perfil-negocio-gestion.response.dto';
import {
  NegocioMarcaDto,
  PerfilNegocioPublicoResponseDto,
} from '../dto/dto-respuesta/perfil-negocio-publico.response.dto';

/**
 * Servicio del perfil de marca y ubicación de un negocio (Fase 14).
 *
 * AISLAMIENTO
 * -----------
 * El negocio es SIEMPRE el del CONTEXTO de la petición, establecido por el
 * servidor a partir del subdominio o de la cabecera `X-Negocio-Slug`. Nunca
 * se toma del cuerpo de la petición ni de un parámetro: un `negocioId`
 * enviado por el cliente ni siquiera llega al servicio (el `ValidationPipe`
 * global rechaza los campos desconocidos).
 *
 * La escritura se ejecuta DENTRO del contexto del negocio, de modo que la
 * extensión de aislamiento de Prisma fuerza ese `negocioId` en el `where` y
 * en el `create`: el perfil de una barbería no puede tocar el de otra.
 *
 * PERFIL INCOMPLETO
 * -----------------
 * Un negocio puede existir SIN perfil: la tabla solo nace cuando alguien
 * configura algo. En ese caso la lectura responde 200 con los campos a `null`
 * y `configurado: false`, NO un 404: la ausencia de perfil es un estado
 * legítimo de una barbería recién dada de alta.
 */
@Injectable()
export class PerfilNegocioService {
  constructor(
    private readonly repository: PerfilNegocioRepository,
    private readonly contextoService: NegocioContextoService,
    private readonly aislamientoService: NegocioAislamientoService,
    private readonly negociosRepository: NegociosRepository,
  ) {}

  /**
   * Vista PÚBLICA del perfil del negocio del contexto.
   */
  async obtenerPerfilPublico(): Promise<PerfilNegocioPublicoResponseDto> {
    const contexto = this.contextoRequerido();
    const perfil = await this.repository.buscarPorNegocio(contexto.id);
    const negocio = await this.datosNegocio(contexto);

    return this.mapearPublico(negocio, perfil);
  }

  /**
   * Vista ADMINISTRATIVA del perfil del negocio del contexto.
   *
   * Incluye la auditoría y distingue los bloques que gestiona la API.
   */
  async obtenerPerfilGestion(): Promise<PerfilNegocioGestionResponseDto> {
    const contexto = this.contextoRequerido();
    const perfil = await this.repository.buscarPorNegocio(contexto.id);
    const negocio = await this.datosNegocio(contexto);

    return this.mapearGestion(negocio, perfil);
  }

  /**
   * Actualiza el CONTENIDO y la UBICACIÓN del perfil.
   *
   * Semántica de reemplazo: los campos omitidos se guardan como `null`.
   */
  async actualizarPerfil(
    dto: ActualizarPerfilNegocioDto,
  ): Promise<PerfilNegocioGestionResponseDto> {
    const contexto = this.contextoRequerido();

    const perfil = await this.aislamientoService.ejecutarEnNegocio(
      contexto,
      () =>
        this.repository.guardar(contexto.id, {
          frasePrincipal: dto.frasePrincipal ?? null,
          direccion: dto.direccion ?? null,
          ciudad: dto.ciudad ?? null,
          departamento: dto.departamento ?? null,
          referencia: dto.referencia ?? null,
          latitud: dto.latitud ?? null,
          longitud: dto.longitud ?? null,
        }),
    );

    const negocio = await this.datosNegocio(contexto);

    return this.mapearGestion(negocio, perfil);
  }

  /**
   * Actualiza las REFERENCIAS A ARCHIVOS de la identidad visual.
   *
   * En esta fase NO se suben archivos: solo se guardan las referencias. La
   * carga física de imágenes es una fase posterior.
   */
  async actualizarReferencias(
    dto: ActualizarReferenciasPerfilDto,
  ): Promise<PerfilNegocioGestionResponseDto> {
    const contexto = this.contextoRequerido();

    const perfil = await this.aislamientoService.ejecutarEnNegocio(
      contexto,
      () =>
        this.repository.guardar(contexto.id, {
          faviconUrl: dto.faviconUrl ?? null,
          bannerUrl: dto.bannerUrl ?? null,
          logoBlancoUrl: dto.logoBlancoUrl ?? null,
          logoNegroUrl: dto.logoNegroUrl ?? null,
        }),
    );

    const negocio = await this.datosNegocio(contexto);

    return this.mapearGestion(negocio, perfil);
  }

  /**
   * Contexto de negocio de la petición.
   *
   * @throws ForbiddenException si la petición no tiene un contexto de
   * negocio autorizado. Es un fallo SEGURO: sin contexto no se sabe a qué
   * barbería pertenece el perfil, y devolver el de otra sería una fuga.
   */
  private contextoRequerido(): ContextoNegocio {
    const contexto = this.contextoService.obtenerContexto();

    if (!contexto) {
      throw new ForbiddenException(
        'La consulta del perfil requiere un contexto de negocio autorizado',
      );
    }

    return contexto;
  }

  /** Datos públicos del negocio del contexto (nombre y slug). */
  private async datosNegocio(
    contexto: ContextoNegocio,
  ): Promise<NegocioMarcaDto> {
    const negocio = await this.negociosRepository.buscarPorId(contexto.id);

    if (!negocio) {
      throw new NotFoundException('El negocio no está disponible');
    }

    return { nombre: negocio.nombre, slug: negocio.slug };
  }

  /** Convierte un decimal stored en base de datos en número, o `null`. */
  private coordenada(valor: string | null): number | null {
    if (valor === null) {
      return null;
    }

    const numero = Number(valor);

    return Number.isFinite(numero) ? numero : null;
  }

  /** Mapea el registro a la vista pública. */
  private mapearPublico(
    negocio: NegocioMarcaDto,
    perfil: PerfilNegocioRegistro | null,
  ): PerfilNegocioPublicoResponseDto {
    const latitud = perfil ? this.coordenada(perfil.latitud) : null;
    const longitud = perfil ? this.coordenada(perfil.longitud) : null;

    return {
      negocio,
      configurado: perfil !== null,
      frasePrincipal: perfil?.frasePrincipal ?? null,
      faviconUrl: perfil?.faviconUrl ?? null,
      bannerUrl: perfil?.bannerUrl ?? null,
      logoBlancoUrl: perfil?.logoBlancoUrl ?? null,
      logoNegroUrl: perfil?.logoNegroUrl ?? null,
      direccion: perfil?.direccion ?? null,
      ciudad: perfil?.ciudad ?? null,
      departamento: perfil?.departamento ?? null,
      referencia: perfil?.referencia ?? null,
      latitud,
      longitud,
      mapsUrl: derivarUrlMapa(latitud, longitud),
    };
  }

  /** Mapea el registro a la vista administrativa. */
  private mapearGestion(
    negocio: NegocioMarcaDto,
    perfil: PerfilNegocioRegistro | null,
  ): PerfilNegocioGestionResponseDto {
    const latitud = perfil ? this.coordenada(perfil.latitud) : null;
    const longitud = perfil ? this.coordenada(perfil.longitud) : null;

    return {
      negocio,
      configurado: perfil !== null,
      contenido: {
        frasePrincipal: perfil?.frasePrincipal ?? null,
      },
      ubicacion: {
        direccion: perfil?.direccion ?? null,
        ciudad: perfil?.ciudad ?? null,
        departamento: perfil?.departamento ?? null,
        referencia: perfil?.referencia ?? null,
        latitud,
        longitud,
        mapsUrl: derivarUrlMapa(latitud, longitud),
      },
      referenciasArchivo: {
        faviconUrl: perfil?.faviconUrl ?? null,
        bannerUrl: perfil?.bannerUrl ?? null,
        logoBlancoUrl: perfil?.logoBlancoUrl ?? null,
        logoNegroUrl: perfil?.logoNegroUrl ?? null,
      },
      creadoEn: perfil?.createdAt ?? new Date(0),
      actualizadoEn: perfil?.updatedAt ?? new Date(0),
    };
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { ContextoNegocio } from '../../negocios/negocio-almacenamiento';
import { NegociosRepository } from '../../negocios/repository/negocios.repository';
import { PREFIJO_PUBLICO_UPLOADS } from '../../../common/config/uploads.config';
import { detectarTipoArchivo } from '../../../common/security/detectar-tipo-archivo';
import { sanitizarSvg } from '../../../common/security/sanitizar-svg';
import {
  PerfilNegocioRegistro,
  PerfilNegocioRepository,
} from '../repository/perfil-negocio.repository';
import {
  definicionRecurso,
  derivarUrlMapa,
  DefinicionRecursoPerfil,
  RecursoPerfil,
} from '../perfil-negocio.constants';
import {
  ActualizarPerfilNegocioDto,
  ActualizarReferenciasPerfilDto,
} from '../dto/dto-peticion/actualizar-perfil-negocio.dto';
import { PerfilNegocioGestionResponseDto } from '../dto/dto-respuesta/perfil-negocio-gestion.response.dto';
import {
  NegocioMarcaDto,
  PerfilNegocioPublicoResponseDto,
} from '../dto/dto-respuesta/perfil-negocio-publico.response.dto';
import { AlmacenamientoPerfilService } from './almacenamiento-perfil.service';

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
    private readonly almacenamiento: AlmacenamientoPerfilService,
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
   * Dirección COMERCIAL del negocio del contexto.
   *
   * `PerfilNegocio.direccion` es la fuente canónica de la dirección. Se
   * devuelve vacía (no `null`) cuando el negocio no tiene perfil o no ha
   * configurado la dirección: quien la consume decide qué hacer con un dato
   * ausente, y nunca se inventa una dirección.
   */
  async obtenerDireccionComercial(): Promise<string> {
    const contexto = this.contextoRequerido();

    const perfil = await this.repository.buscarPorNegocio(contexto.id);

    return perfil?.direccion?.trim() ?? '';
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
          ...(dto.temaKey !== undefined ? { temaKey: dto.temaKey } : {}),
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
   *
   * Semántica de reemplazo: los campos omitidos se guardan como `null`.
   */
  async actualizarReferencias(
    dto: ActualizarReferenciasPerfilDto,
  ): Promise<PerfilNegocioGestionResponseDto> {
    const contexto = this.contextoRequerido();

    this.validarReferenciasPropias(contexto, dto);

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
   * Sube (o reemplaza) un recurso de marca del negocio del contexto.
   *
   * El contenido se valida por su FORMA REAL (no por el nombre ni por el
   * `Content-Type` del cliente), se sanea si es SVG y se guarda con un nombre
   * generado por el servidor en el espacio del negocio.
   *
   * ORDEN DE LAS OPERACIONES (evita referencias rotas):
   *   1. Se valida el contenido.
   *   2. Se guarda el archivo nuevo.
   *   3. Se actualiza el perfil con la referencia nueva.
   *   4. Se elimina el archivo ANTERIOR.
   * Si el paso 3 falla, el archivo nuevo se borra y el perfil conserva la
   * referencia anterior: nunca queda una referencia que no apunta a nada.
   */
  async subirRecurso(
    recurso: RecursoPerfil,
    archivo: Express.Multer.File | undefined,
  ): Promise<PerfilNegocioGestionResponseDto> {
    const definicion = definicionRecurso(recurso);
    const contexto = this.contextoRequerido();

    if (!archivo) {
      throw new BadRequestException(
        `No se ha proporcionado el archivo del recurso '${definicion.etiqueta}'.`,
      );
    }

    const contenido = this.validarContenido(archivo, definicion);

    const perfilPrevio = await this.repository.buscarPorNegocio(contexto.id);
    const referenciaAnterior = perfilPrevio?.[definicion.campo] ?? null;

    const referenciaNueva = await this.almacenamiento.guardar(
      contexto.id,
      definicion,
      contenido,
    );

    try {
      const perfil = await this.aislamientoService.ejecutarEnNegocio(
        contexto,
        () =>
          this.repository.guardar(contexto.id, {
            [definicion.campo]: referenciaNueva,
          }),
      );

      // El archivo anterior solo se elimina cuando el perfil ya apunta al
      // nuevo: si la actualización falló, el anterior sigue en su sitio.
      if (referenciaAnterior && referenciaAnterior !== referenciaNueva) {
        await this.almacenamiento.eliminar(contexto.id, referenciaAnterior);
      }

      const negocio = await this.datosNegocio(contexto);

      return this.mapearGestion(negocio, perfil);
    } catch (error) {
      // La escritura del perfil falló: se retira el archivo nuevo para no
      // dejar recursos huérfanos ni referencias rotas.
      await this.almacenamiento.eliminar(contexto.id, referenciaNueva);

      throw error;
    }
  }

  /**
   * Elimina un recurso de marca del negocio del contexto.
   *
   * Primero se limpia la REFERENCIA del perfil y después se borra el archivo:
   * si el borrado del disco fallara, el perfil ya no apunta al recurso (no
   * queda ninguna referencia rota).
   */
  async eliminarRecurso(
    recurso: RecursoPerfil,
  ): Promise<PerfilNegocioGestionResponseDto> {
    const definicion = definicionRecurso(recurso);
    const contexto = this.contextoRequerido();

    const perfilPrevio = await this.repository.buscarPorNegocio(contexto.id);
    const referencia = perfilPrevio?.[definicion.campo] ?? null;

    const perfil = await this.aislamientoService.ejecutarEnNegocio(
      contexto,
      () =>
        this.repository.guardar(contexto.id, {
          [definicion.campo]: null,
        }),
    );

    await this.almacenamiento.eliminar(contexto.id, referencia);

    const negocio = await this.datosNegocio(contexto);

    return this.mapearGestion(negocio, perfil);
  }

  /**
   * Valida el CONTENIDO real del archivo y devuelve el contenido ya saneado.
   *
   * El tipo se deduce de la firma del archivo, no de lo que declara el
   * cliente. Un SVG se sanea antes de guardarse.
   */
  private validarContenido(
    archivo: Express.Multer.File,
    definicion: DefinicionRecursoPerfil,
  ): Buffer {
    const contenido = archivo.buffer;

    if (!contenido || contenido.length === 0) {
      throw new BadRequestException('El archivo enviado está vacío.');
    }

    if (contenido.length > definicion.limiteBytes) {
      throw new PayloadTooLargeException(
        `El archivo '${definicion.etiqueta}' supera el tamaño máximo admitido ` +
          `(${definicion.limiteBytes} bytes).`,
      );
    }

    const tipo = detectarTipoArchivo(contenido);

    if (tipo !== definicion.formato) {
      throw new BadRequestException(
        `El recurso '${definicion.etiqueta}' solo admite archivos ` +
          `${definicion.formato.toUpperCase()}; el contenido enviado es ` +
          `${tipo === 'desconocido' ? 'de un formato no admitido' : tipo.toUpperCase()}.`,
      );
    }

    if (tipo === 'svg') {
      return Buffer.from(sanitizarSvg(contenido.toString('utf8')), 'utf8');
    }

    return contenido;
  }

  /**
   * Comprueba que las referencias que fija el cliente son del PROPIO negocio.
   *
   * Se admiten:
   * - URLs externas `http`/`https` (recursos gestionados por el cliente).
   * - Rutas internas del espacio de recursos de ESTE negocio.
   *
   * Se rechazan las rutas internas de OTRO negocio: el cliente no puede
   * apropiarse de un recurso ajeno.
   */
  private validarReferenciasPropias(
    contexto: ContextoNegocio,
    dto: ActualizarReferenciasPerfilDto,
  ): void {
    const prefijoPropio = `${PREFIJO_PUBLICO_UPLOADS}/negocios/${contexto.id}/perfil/`;

    const referencias: Array<[string, string | undefined]> = [
      ['faviconUrl', dto.faviconUrl],
      ['bannerUrl', dto.bannerUrl],
      ['logoBlancoUrl', dto.logoBlancoUrl],
      ['logoNegroUrl', dto.logoNegroUrl],
    ];

    for (const [campo, referencia] of referencias) {
      if (!referencia) {
        continue;
      }

      if (/^https?:\/\//i.test(referencia)) {
        continue;
      }

      if (!referencia.startsWith(prefijoPropio)) {
        throw new BadRequestException(
          `La referencia de '${campo}' debe ser una URL http/https o un recurso ` +
            `propio del negocio (${prefijoPropio}...).`,
        );
      }

      if (referencia.includes('..')) {
        throw new BadRequestException(
          `La referencia de '${campo}' no puede contener rutas relativas ('..').`,
        );
      }
    }
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
      temaKey: perfil?.temaKey ?? "clasico-azul",
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
        temaKey: perfil?.temaKey ?? 'clasico-azul',
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

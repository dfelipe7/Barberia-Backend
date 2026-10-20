import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CABECERA_SLUG_NEGOCIO,
  CLAVES_CONFIGURACION_NEGOCIO,
  ORIGEN_RESOLUCION_NEGOCIO,
  OrigenResolucionNegocio,
  REGEX_SLUG_NEGOCIO,
} from '../negocios.constants';
import { NegocioContextoService } from '../negocio-contexto.service';
import { NegociosRepository } from '../repository/negocios.repository';

/**
 * Resultado de intentar resolver el negocio de una petición.
 *
 * `SIN_NEGOCIO` significa que la petición no apunta a ningún negocio (por
 * ejemplo, una ruta global de plataforma). `RESUELTO` indica el negocio
 * activo. `RECHAZADO` se usa cuando la petición APUNTA a un negocio que no
 * existe o está inactivo: en ese caso la petición debe fallar, nunca
 * ejecutarse sin tenant.
 */
export type ResultadoResolucionNegocio =
  | { estado: 'SIN_NEGOCIO' }
  | { estado: 'RESUELTO'; negocioId: number; slug: string }
  | { estado: 'RECHAZADO' };

/**
 * Resolución del negocio activo de una petición.
 *
 * Fuentes admitidas, en este orden de prioridad:
 *  1. Subdominio: `acme.<NEGOCIO_DOMINIO_BASE>` -> slug `acme`. Es el
 *     mecanismo principal en producción. Requiere que `NEGOCIO_DOMINIO_BASE`
 *     esté configurado: sin ese valor NO se interpreta el `Host`, porque no
 *     se debe adivinar el dominio base.
 *  2. Cabecera `X-Negocio-Slug`: alternativa controlada para clientes
 *     móviles, emuladores y entornos sin subdominio. Se puede restringir en
 *     producción con `NEGOCIO_PERMITIR_HEADER_SLUG=false`.
 *
 * El identificador resultante se valida contra la tabla `negocios`: un slug
 * inexistente o de un negocio inactivo produce un RECHAZO SEGURO (404), no
 * una ejecución sin negocio. No se revela si el negocio existe pero está
 * inactivo: la respuesta es la misma en ambos casos.
 */
@Injectable()
export class NegocioResolucionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly negociosRepository: NegociosRepository,
    private readonly contextoService: NegocioContextoService,
  ) {}

  /**
   * Resuelve el negocio a partir de los identificadores públicos de la
   * petición (subdominio y/o cabecera `X-Negocio-Slug`).
   */
  async resolverDesdePeticion(peticion: {
    hostname?: string;
    headers?: Record<string, string | string[] | undefined>;
  }): Promise<ResultadoResolucionNegocio> {
    const candidato = this.extraerSlugCandidato(peticion);

    if (!candidato) {
      return { estado: 'SIN_NEGOCIO' };
    }

    const negocio = await this.negociosRepository.buscarActivoPorSlug(
      candidato.slug,
    );

    if (!negocio) {
      return { estado: 'RECHAZADO' };
    }

    return {
      estado: 'RESUELTO',
      negocioId: negocio.id,
      slug: negocio.slug,
    };
  }

  /**
   * Extrae el slug candidato de la petición, sin consultar la base de datos.
   *
   * Se expone por separado para poder probar la precedencia entre fuentes y
   * el rechazo de formatos inválidos sin acoplarlo a la persistencia.
   */
  extraerSlugCandidato(peticion: {
    hostname?: string;
    headers?: Record<string, string | string[] | undefined>;
  }): { slug: string; origen: OrigenResolucionNegocio } | null {
    const desdeSubdominio = this.extraerSlugDeSubdominio(peticion.hostname);

    if (desdeSubdominio) {
      return {
        slug: desdeSubdominio,
        origen: ORIGEN_RESOLUCION_NEGOCIO.SUBDOMINIO,
      };
    }

    if (!this.headerPermitido()) {
      return null;
    }

    const desdeCabecera = this.extraerSlugDeCabecera(peticion.headers);

    if (desdeCabecera) {
      return {
        slug: desdeCabecera,
        origen: ORIGEN_RESOLUCION_NEGOCIO.CABECERA,
      };
    }

    return null;
  }

  /**
   * Extrae el slug del subdominio, si el host pertenece al dominio base
   * configurado.
   *
   * `NEGOCIO_DOMINIO_BASE` es obligatorio para esta vía: sin él, el `Host` no
   * se interpreta, porque no se conoce el dominio base y adivinarlo
   * permitiría que cualquier host resolviera un negocio.
   */
  private extraerSlugDeSubdominio(hostname?: string): string | null {
    const dominioBase = this.dominioBase();

    if (!dominioBase || !hostname) {
      return null;
    }

    const host = hostname.toLowerCase();

    if (!host.endsWith(`.${dominioBase}`)) {
      return null;
    }

    const subdominio = host.slice(0, -(dominioBase.length + 1));

    // Un host como `a.b.dominio.com` no es un identificador de negocio: se
    // descarta en lugar de tomar un fragmento arbitrario.
    if (!subdominio || subdominio.includes('.')) {
      return null;
    }

    return REGEX_SLUG_NEGOCIO.test(subdominio) ? subdominio : null;
  }

  /** Extrae y normaliza el slug de la cabecera `X-Negocio-Slug`. */
  private extraerSlugDeCabecera(
    headers?: Record<string, string | string[] | undefined>,
  ): string | null {
    const valor = headers?.[CABECERA_SLUG_NEGOCIO];

    const bruto = Array.isArray(valor) ? valor[0] : valor;

    if (!bruto) {
      return null;
    }

    const slug = bruto.trim().toLowerCase();

    return REGEX_SLUG_NEGOCIO.test(slug) ? slug : null;
  }

  /** Dominio base configurado para los subdominios de negocio. */
  private dominioBase(): string | null {
    const valor = this.configService.get<string>(
      CLAVES_CONFIGURACION_NEGOCIO.DOMINIO_BASE,
    );

    if (!valor) {
      return null;
    }

    return valor
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, '');
  }

  /**
   * Indica si la cabecera `X-Negocio-Slug` puede usarse para resolver el
   * negocio. Se puede restringir en producción fijando
   * `NEGOCIO_PERMITIR_HEADER_SLUG=false`.
   */
  private headerPermitido(): boolean {
    const valor = this.configService.get<string>(
      CLAVES_CONFIGURACION_NEGOCIO.PERMITIR_HEADER_SLUG,
    );

    if (valor === undefined || valor === null) {
      // Por defecto se permite: es la vía alternativa para clientes móviles
      // y emuladores. En producción se restringe explícitamente.
      return true;
    }

    return valor.trim().toLowerCase() !== 'false';
  }

  /**
   * Traduce un resultado de resolución a una respuesta HTTP cuando el
   * negocio no puede establecerse.
   *
   * El mensaje es idéntico para "no existe" y "está inactivo": no se revela
   * la existencia de negocios desactivados.
   */
  lanzarRechazoPorNegocioInvalido(): never {
    throw new NotFoundException('El negocio solicitado no está disponible');
  }

  /**
   * Establece el contexto de negocio para el resto de la cadena asíncrona.
   *
   * `operacion` debe invocar `next()` (o la continuación equivalente) para
   * que el contexto abarque todo el procesamiento posterior.
   */
  ejecutarConContexto<T>(
    negocioId: number,
    slug: string,
    operacion: () => T,
  ): T {
    return this.contextoService.ejecutarEnContexto(
      { id: negocioId, slug },
      operacion,
    );
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CampoReferenciaPerfil } from '../perfil-negocio.constants';

/**
 * Fila de `perfiles_negocio`, desacoplada de los tipos de Prisma.
 *
 * Las coordenadas se exponen como TEXTO: el repositorio no decide el formato
 * con el que se entregan al frontend (ese trabajo es del servicio).
 */
export interface PerfilNegocioRegistro {
  id: number;
  negocioId: number;
  frasePrincipal: string | null;
  temaKey: string | null;
  faviconUrl: string | null;
  bannerUrl: string | null;
  logoBlancoUrl: string | null;
  logoNegroUrl: string | null;
  direccion: string | null;
  ciudad: string | null;
  departamento: string | null;
  referencia: string | null;
  latitud: string | null;
  longitud: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Contenido y ubicación que se pueden actualizar del perfil. */
export interface ContenidoUbicacionPerfil {
  temaKey?: string | null;
  frasePrincipal: string | null;
  direccion: string | null;
  ciudad: string | null;
  departamento: string | null;
  referencia: string | null;
  latitud: number | null;
  longitud: number | null;
}

/** Referencias a archivos de la identidad visual. */
export interface ReferenciasArchivoPerfil {
  faviconUrl: string | null;
  bannerUrl: string | null;
  logoBlancoUrl: string | null;
  logoNegroUrl: string | null;
}

/** Proyección de las columnas que se devuelven al resto de la aplicación. */
const SELECCION_PERFIL = {
  id: true,
  negocioId: true,
  frasePrincipal: true,
  temaKey: true,
  faviconUrl: true,
  bannerUrl: true,
  logoBlancoUrl: true,
  logoNegroUrl: true,
  direccion: true,
  ciudad: true,
  departamento: true,
  referencia: true,
  latitud: true,
  longitud: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Acceso a la tabla `perfiles_negocio`.
 *
 * AISLAMIENTO
 * -----------
 * `PerfilNegocio` es un modelo TENANT-SCOPED: la extensión de Prisma acota
 * automáticamente toda lectura y escritura al negocio del contexto en curso.
 * Además, este repositorio exige el `negocioId` de forma EXPLÍCITA en la
 * condición: nunca se resuelve un perfil por la clave sola, para que una
 * lectura no pueda devolver el perfil de otra barbería.
 */
@Injectable()
export class PerfilNegocioRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Devuelve el perfil del negocio indicado, o `null` si todavía no se ha
   * configurado.
   */
  async buscarPorNegocio(
    negocioId: number,
  ): Promise<PerfilNegocioRegistro | null> {
    const perfil = await this.prisma.perfilNegocio.findUnique({
      where: { negocioId },
      select: SELECCION_PERFIL,
    });

    if (!perfil) {
      return null;
    }

    return {
      id: perfil.id,
      negocioId: perfil.negocioId,
      frasePrincipal: perfil.frasePrincipal,
      temaKey: perfil.temaKey ?? 'clasico-azul',
      faviconUrl: perfil.faviconUrl,
      bannerUrl: perfil.bannerUrl,
      logoBlancoUrl: perfil.logoBlancoUrl,
      logoNegroUrl: perfil.logoNegroUrl,
      direccion: perfil.direccion,
      ciudad: perfil.ciudad,
      departamento: perfil.departamento,
      referencia: perfil.referencia,
      latitud: perfil.latitud?.toString() ?? null,
      longitud: perfil.longitud?.toString() ?? null,
      createdAt: perfil.createdAt,
      updatedAt: perfil.updatedAt,
    };
  }

  /**
   * Actualiza UNA referencia de archivo del perfil del negocio.
   *
   * Se usa al subir o eliminar un recurso de marca: solo se toca el campo
   * indicado y el resto del perfil se conserva.
   */
  async guardarReferencia(
    negocioId: number,
    campo: CampoReferenciaPerfil,
    valor: string | null,
  ): Promise<PerfilNegocioRegistro> {
    const perfil = await this.prisma.perfilNegocio.upsert({
      where: { negocioId },
      update: { [campo]: valor },
      create: { negocioId, [campo]: valor },
      select: SELECCION_PERFIL,
    });

    return this.mapear(perfil);
  }

  /**
   * Crea o actualiza el perfil del negocio indicado.
   *
   * Es idempotente: la clave única es `negocioId`, de modo que nunca hay dos
   * perfiles para la misma barbería. La escritura se ejecuta dentro del
   * contexto del negocio, así que la extensión de aislamiento fuerza ese
   * `negocioId` tanto en el `where` como en el `create`.
   */
  async guardar(
    negocioId: number,
    datos: Partial<ContenidoUbicacionPerfil & ReferenciasArchivoPerfil>,
  ): Promise<PerfilNegocioRegistro> {
    const perfil = await this.prisma.perfilNegocio.upsert({
      where: { negocioId },
      update: datos,
      create: { negocioId, ...datos },
      select: SELECCION_PERFIL,
    });

    return this.mapear(perfil);
  }

  /** Convierte la fila de Prisma en el registro desacoplado. */
  private mapear(
    perfil: Prisma.PerfilNegocioGetPayload<{ select: typeof SELECCION_PERFIL }>,
  ): PerfilNegocioRegistro {
    return {
      id: perfil.id,
      negocioId: perfil.negocioId,
      frasePrincipal: perfil.frasePrincipal,
      temaKey: perfil.temaKey ?? 'clasico-azul',
      faviconUrl: perfil.faviconUrl,
      bannerUrl: perfil.bannerUrl,
      logoBlancoUrl: perfil.logoBlancoUrl,
      logoNegroUrl: perfil.logoNegroUrl,
      direccion: perfil.direccion,
      ciudad: perfil.ciudad,
      departamento: perfil.departamento,
      referencia: perfil.referencia,
      latitud: perfil.latitud?.toString() ?? null,
      longitud: perfil.longitud?.toString() ?? null,
      createdAt: perfil.createdAt,
      updatedAt: perfil.updatedAt,
    };
  }
}

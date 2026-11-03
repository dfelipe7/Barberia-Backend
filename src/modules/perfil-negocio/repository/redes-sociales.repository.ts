import { Injectable } from '@nestjs/common';
import { TipoRedSocial } from '../../../../generated/prisma/enums';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';

/**
 * Fila de `redes_sociales_negocio`, desacoplada de los tipos de Prisma.
 */
export type RedSocialRegistro = {
  id: number;
  tipo: TipoRedSocial;
  nombre: string;
  url: string;
  orden: number;
  activo: boolean;
};

/** Proyección mínima que devuelven todos los métodos del repositorio. */
const SELECCION_RED_SOCIAL = {
  id: true,
  tipo: true,
  nombre: true,
  url: true,
  orden: true,
  activo: true,
} as const;

/**
 * Acceso a la tabla `redes_sociales_negocio`.
 *
 * AISLAMIENTO
 * -----------
 * Todos los métodos reciben `negocioId` de forma EXPLÍCITA y lo incorporan al
 * `where` mediante `filtroLectura` / `filtroEscritura`. La extensión de Prisma
 * actúa como defensa adicional: ninguna consulta puede devolver filas de otro
 * negocio.
 */
@Injectable()
export class RedesSocialesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  /**
   * Devuelve las redes sociales ACTIVAS del negocio, ordenadas por `orden`
   * ascendente y, en caso de empate, por `id` ascendente.
   */
  async listarPorNegocio(
    negocioId: number,
    incluirInactivas = false,
  ): Promise<RedSocialRegistro[]> {
    const where = incluirInactivas
      ? { negocioId }
      : { negocioId, activo: true };

    const filas = await this.prisma.redSocialNegocio.findMany({
      where: this.aislamiento.filtroLectura(where),
      orderBy: [{ orden: 'asc' }, { id: 'asc' }],
      select: SELECCION_RED_SOCIAL,
    });

    return filas;
  }

  /**
   * Reemplaza el conjunto de redes del negocio:
   * - Desactiva las que NO aparecen en `redes`.
   * - Hace upsert de las que sí aparecen (crea o actualiza por clave única
   *   `(negocioId, tipo, nombre)`).
   *
   * @param negocioId ID del negocio.
   * @param redes     Lista de redes que deben quedar activas.
   */
  async reemplazar(
    negocioId: number,
    redes: Array<{
      tipo: TipoRedSocial;
      nombre: string;
      url: string;
      orden: number;
    }>,
  ): Promise<RedSocialRegistro[]> {
    const claves = redes.map((r) => ({ tipo: r.tipo, nombre: r.nombre }));

    // 1. Desactivar las que no están en la nueva lista.
    await this.prisma.redSocialNegocio.updateMany({
      where: this.aislamiento.filtroLectura({
        negocioId,
        NOT: claves.length > 0 ? { AND: [{ OR: claves }] } : undefined,
      }),
      data: { activo: false },
    });

    // 2. Upsert de cada red de la nueva lista.
    for (const red of redes) {
      await this.prisma.redSocialNegocio.upsert({
        where: {
          negocioId_tipo_nombre: {
            negocioId,
            tipo: red.tipo,
            nombre: red.nombre,
          },
        },
        update: { url: red.url, orden: red.orden, activo: true },
        create: {
          negocioId,
          tipo: red.tipo,
          nombre: red.nombre,
          url: red.url,
          orden: red.orden,
          activo: true,
        },
      });
    }

    return this.listarPorNegocio(negocioId);
  }

  /**
   * Devuelve una red social del negocio por su `id`, o `null` si no existe
   * o pertenece a otro negocio.
   */
  async obtenerPorId(
    negocioId: number,
    id: number,
  ): Promise<RedSocialRegistro | null> {
    const fila = await this.prisma.redSocialNegocio.findUnique({
      where: { negocioId_id: { negocioId, id } },
      select: SELECCION_RED_SOCIAL,
    });

    return fila ?? null;
  }

  /**
   * Actualiza los campos indicados de UNA red social.
   *
   * @returns La fila actualizada.
   */
  async actualizar(
    negocioId: number,
    id: number,
    datos: { url?: string; nombre?: string; orden?: number },
  ): Promise<RedSocialRegistro> {
    return this.prisma.redSocialNegocio.update({
      where: { negocioId_id: { negocioId, id } },
      data: datos,
      select: SELECCION_RED_SOCIAL,
    });
  }

  /**
   * Soft-delete: marca la red como `activo = false`.
   */
  /**
   * Eliminación física: borra definitivamente el registro de la BD.
   */
  async eliminarFisico(negocioId: number, id: number): Promise<RedSocialRegistro> {
    return this.prisma.redSocialNegocio.delete({
      where: { negocioId_id: { negocioId, id } },
      select: SELECCION_RED_SOCIAL,
    });
  }

  async desactivar(negocioId: number, id: number): Promise<RedSocialRegistro> {
    return this.prisma.redSocialNegocio.update({
      where: { negocioId_id: { negocioId, id } },
      data: { activo: false },
      select: SELECCION_RED_SOCIAL,
    });
  }

  /**
   * Reactiva una red social: `activo = true`.
   * Es idempotente: si ya está activa no hace nada.
   */
  async activar(negocioId: number, id: number): Promise<RedSocialRegistro> {
    return this.prisma.redSocialNegocio.update({
      where: { negocioId_id: { negocioId, id } },
      data: { activo: true },
      select: SELECCION_RED_SOCIAL,
    });
  }

  /**
   * Comprueba si existe otra red activa con la misma `(tipo, nombre)` para el
   * negocio, excluyendo la red indicada por `id`.
   *
   * Se usa para validar colisiones al renombrar una red de tipo OTRO o al reactivar.
   */
  async existeOtraActivaConMismaClave(
    negocioId: number,
    id: number,
    tipo: TipoRedSocial,
    nombre: string,
  ): Promise<boolean> {
    const fila = await this.prisma.redSocialNegocio.findFirst({
      where: this.aislamiento.filtroLectura({
        negocioId,
        tipo,
        nombre,
        activo: true,
        id: { not: id },
      }),
      select: { id: true },
    });

    return fila !== null;
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Plantilla de WhatsApp tal y como la expone el repositorio.
 */
export interface PlantillaWhatsApp {
  tipo: string;
  mensaje: string;
  negocioId: number | null;
}

/**
 * Acceso a `whatsapp_plantillas` (HU-11).
 *
 * ALCANCE DE LA TABLA
 * -------------------
 * `whatsapp_plantillas` sigue siendo un modelo GLOBAL para la extensión de
 * Prisma (no es tenant-scoped): lo que hace es admitir filas GLOBALES
 * (`negocioId = NULL`, el valor por defecto de la plataforma) y filas PROPIAS de
 * un negocio. Por eso el filtro por negocio se aplica AQUÍ, de forma
 * explícita, y no se delega en la extensión.
 *
 * REGLA DE RESOLUCIÓN
 * -------------------
 *   1. La plantilla del NEGOCIO (si existe) tiene prioridad.
 *   2. Si no, la plantilla GLOBAL de la plataforma.
 *   3. Si no, el texto por defecto del código.
 */
@Injectable()
export class WhatsAppPlantillasRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Devuelve las plantillas visibles para un negocio: las SUyas y las globales.
   *
   * Con `negocioId = null` devuelve únicamente las globales (uso de plataforma).
   *
   * Solo se devuelven las plantillas ACTIVAS: una plantilla desactivada
   * (`activo = false`) se ignora, igual que antes de HU-11.
   */
  async obtenerPlantillas(
    negocioId: number | null,
  ): Promise<PlantillaWhatsApp[]> {
    const where =
      negocioId === null
        ? { negocioId: null, activo: true }
        : { activo: true, OR: [{ negocioId }, { negocioId: null }] };

    const filas = await this.prisma.whatsAppPlantilla.findMany({
      where,
      select: { tipo: true, mensaje: true, negocioId: true },
    });

    return filas.map((fila) => ({
      tipo: fila.tipo,
      mensaje: fila.mensaje,
      negocioId: fila.negocioId,
    }));
  }

  /**
   * Guarda (o actualiza) la plantilla de un tipo para un negocio.
   *
   * Con `negocioId = null` escribe la plantilla GLOBAL de la plataforma.
   */
  async guardarPlantilla(
    negocioId: number | null,
    tipo: string,
    mensaje: string,
  ): Promise<void> {
    if (negocioId === null) {
      await this.prisma.whatsAppPlantilla.upsert({
        where: { claveGlobal: tipo },
        update: { mensaje, activo: true },
        create: { tipo, mensaje, activo: true, negocioId: null },
      });
      return;
    }

    await this.prisma.whatsAppPlantilla.upsert({
      where: { negocioId_tipo: { negocioId, tipo } },
      update: { mensaje, activo: true },
      create: { tipo, mensaje, activo: true, negocioId },
    });
  }

  /**
   * Elimina las plantillas propias de un negocio (o las globales si
   * `negocioId` es `null`), devolviendo cuántos registros se eliminaron.
   */
  async eliminarPlantillas(
    negocioId: number | null,
    tipos: string[],
  ): Promise<number> {
    const resultado = await this.prisma.whatsAppPlantilla.deleteMany({
      where: { negocioId, tipo: { in: tipos } },
    });

    return resultado.count;
  }
}

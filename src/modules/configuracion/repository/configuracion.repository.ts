import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CLAVES_CONFIGURACION_OPERATIVA } from '../configuracion.constants';

/**
 * Representación desacoplada de una fila de configuración, para no exponer los
 * tipos generados de Prisma al resto de la aplicación.
 *
 * Sirve tanto para `configuraciones_sistema` (ámbito global) como para
 * `configuraciones_negocio` (ámbito de negocio): la forma de la fila es la
 * misma, lo que cambia es el ámbito en el que se busca.
 */
export interface ConfiguracionRegistro {
  clave: string;
  valor: string;
  tipo: string;
  editable: boolean;
}

/**
 * Acceso a las tablas de configuración.
 *
 * Centraliza la lectura de parámetros funcionales almacenados en base de datos.
 * No contiene reglas de negocio ni conversión de tipos: eso vive en
 * `ConfiguracionService`.
 *
 * AISLAMIENTO
 * -----------
 * - `buscarPorClave` lee el ÁMBITO GLOBAL (`configuraciones_sistema`).
 * - `buscarPorClaveEnNegocio` lee el ÁMBITO DE NEGOCIO
 *   (`configuraciones_negocio`) exigiendo `negocioId` y `clave` de forma
 *   EXPLÍCITA en la condición. Nunca se resuelve una configuración operativa
 *   por la clave sola: eso podría devolver el valor de otra barbería.
 */
@Injectable()
export class ConfiguracionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Devuelve la configuración GLOBAL con la clave indicada, o `null` si no
   * existe. Usa `select` explícito para traer solo los campos necesarios.
   */
  async buscarPorClave(clave: string): Promise<ConfiguracionRegistro | null> {
    const registro = await this.prisma.configuracionSistema.findUnique({
      where: { clave },
      select: { clave: true, valor: true, tipo: true, editable: true },
    });

    return registro ?? null;
  }

  /**
   * Devuelve la configuración del NEGOCIO indicado con esa clave, o `null` si
   * el negocio no la tiene.
   *
   * La condición incluye `negocioId` y `clave` de forma explícita. Además, la
   * extensión de aislamiento de Prisma acota la lectura al negocio del
   * contexto en curso: si se pidiera una configuración de OTRO negocio desde
   * una petición de otro, la operación se rechaza en lugar de devolverla.
   */
  async buscarPorClaveEnNegocio(
    negocioId: number,
    clave: string,
  ): Promise<ConfiguracionRegistro | null> {
    const registro = await this.prisma.configuracionNegocio.findFirst({
      where: { negocioId, clave },
      select: { clave: true, valor: true, tipo: true, editable: true },
    });

    return registro ?? null;
  }

  /** Devuelve todas las configuraciones globales, ordenadas por clave. */
  async listar(): Promise<ConfiguracionRegistro[]> {
    return this.prisma.configuracionSistema.findMany({
      select: { clave: true, valor: true, tipo: true, editable: true },
      orderBy: { clave: 'asc' },
    });
  }

  /**
   * Guarda (o actualiza) el valor de una clave de un NEGOCIO.
   *
   * PROTECCIÓN DEL TIPO
   * -------------------
   * El `tipo` de una fila NO se cambia por el hecho de guardar un valor nuevo:
   * una escritura de texto no puede degradar una clave numérica (ni al revés),
   * porque la resolución descarta los valores de tipo incorrecto y el cambio
   * sería silencioso.
   *
   * Si la fila existe con un tipo DISTINTO al de la escritura, la operación
   * FALLA con un error controlado y el registro existente se conserva intacto.
   * La única forma de corregir el tipo de un registro heredado es pedirlo de
   * forma explícita (`corregirTipo: true`), que queda reservada a una
   * reparación validada.
   *
   * La escritura se hace dentro del contexto del negocio indicado: la
   * extensión de aislamiento fuerza el `negocioId`, de modo que la fila solo
   * puede pertenecer a ese negocio.
   */
  async guardarEnNegocio(
    negocioId: number,
    clave: string,
    valor: string,
    tipo: 'TEXTO' | 'NUMERO',
    opciones: { corregirTipo?: boolean } = {},
  ): Promise<void> {
    const existente = await this.buscarPorClaveEnNegocio(negocioId, clave);

    if (existente && existente.tipo !== tipo && !opciones.corregirTipo) {
      throw new ConflictException(
        `La configuración '${clave}' del negocio ya está guardada con tipo '${existente.tipo}' y no admite un valor de tipo '${tipo}'.`,
      );
    }

    // El tipo solo se escribe cuando la fila es nueva o cuando la reparación
    // del tipo ha sido solicitada de forma explícita.
    const tipoAEscribir =
      !existente || (opciones.corregirTipo && existente.tipo !== tipo)
        ? { tipo }
        : {};

    await this.prisma.configuracionNegocio.upsert({
      where: { negocioId_clave: { negocioId, clave } },
      update: { valor, ...tipoAEscribir },
      create: { negocioId, clave, valor, tipo, editable: true },
    });
  }

  /**
   * INICIALIZACIÓN IDEMPOTENTE de las configuraciones operativas de un negocio.
   *
   * Crea únicamente las claves que el negocio NO tiene, con el valor semilla
   * de la política. Una clave ya existente se CONSERVA: su valor puede estar
   * personalizado por un administrador y no debe sobrescribirse. Por eso la
   * inicialización se puede repetir cuantas veces sea necesario.
   *
   * Las escrituras quedan asociadas al negocio indicado: la fila nace con su
   * `negocioId` y, además, la extensión de aislamiento fuerza el negocio del
   * contexto en curso (por eso debe ejecutarse dentro del contexto del
   * negocio que se inicializa).
   */
  async inicializarValoresOperativos(negocioId: number): Promise<{
    creadas: string[];
    conservadas: string[];
  }> {
    const creadas: string[] = [];
    const conservadas: string[] = [];

    for (const config of CLAVES_CONFIGURACION_OPERATIVA) {
      const existente = await this.prisma.configuracionNegocio.findFirst({
        where: { negocioId, clave: config.clave },
        select: { id: true },
      });

      if (existente) {
        conservadas.push(config.clave);
        continue;
      }

      await this.prisma.configuracionNegocio.create({
        data: {
          negocioId,
          clave: config.clave,
          valor: config.valorPorDefecto,
          tipo: config.tipo,
          descripcion: config.descripcion,
          editable: true,
        },
      });

      creadas.push(config.clave);
    }

    return { creadas, conservadas };
  }
}

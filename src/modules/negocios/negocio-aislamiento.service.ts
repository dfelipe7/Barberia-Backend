import { ForbiddenException, Injectable } from '@nestjs/common';
import { NegocioContextoService } from './negocio-contexto.service';

/**
 * Servicio que traduce el contexto de negocio validado en filtros de
 * consulta y escritura.
 *
 * REGLA CENTRAL: el `negocioId` NUNCA se toma del cuerpo de la petición ni
 * de un parámetro del cliente. Siempre se obtiene del contexto del servidor
 * (`NegocioContextoService`), que a su vez se establece a partir del
 * identificador PÚBLICO del negocio (subdominio o `X-Negocio-Slug`) validado
 * contra la tabla `negocios`.
 *
 * Este servicio es la CAPA EXPLÍCITA del aislamiento. La extensión de Prisma
 * (`prisma-extension-aislamiento.ts`) actúa como defensa adicional: si
 * alguien olvidara un filtro en un repositorio, la extensión lo suple.
 * Ninguna de las dos capas sustituye a la otra.
 */
@Injectable()
export class NegocioAislamientoService {
  constructor(private readonly contextoService: NegocioContextoService) {}

  /**
   * Identificador del negocio activo.
   *
   * @throws ForbiddenException si la operación es tenant-scoped y no hay
   * contexto validado. Es un fallo SEGURO: es preferible rechazar la
   * operación a ejecutarla sobre el conjunto completo de negocios.
   */
  negocioIdRequerido(): number {
    return this.contextoService.obtenerContextoRequerido().id;
  }

  /**
   * Filtro de negocio para las operaciones de lectura (`findFirst`,
   * `findMany`, `count`, `aggregate`).
   *
   * El filtro se integra en el `where` de la consulta, NO se aplica después
   * de recuperar la fila: así la base de datos nunca llega a devolver datos
   * de otro negocio, ni siquiera de forma temporal.
   */
  filtroLectura<T extends Record<string, unknown>>(
    where: T = {} as T,
  ): T & { negocioId: number } {
    return { ...where, negocioId: this.negocioIdRequerido() };
  }

  /**
   * Filtro de negocio para las operaciones de escritura por clave
   * (`update`, `delete`).
   *
   * Incorpora el negocio a la MISMA cláusula `where` que identifica el
   * recurso, de modo que la fila solo se modifica si pertenece al negocio
   * activo. Si el recurso es de otro negocio, la operación no afecta a
   * ninguna fila (y el servicio detecta el cambio nulo).
   */
  filtroEscritura<T extends Record<string, unknown>>(
    where: T = {} as T,
  ): T & { negocioId: number } {
    return { ...where, negocioId: this.negocioIdRequerido() };
  }

  /**
   * Comprueba que un recurso pertenece al negocio activo.
   *
   * Se usa cuando la fila ya fue recuperada (por ejemplo, porque la consulta
   * no podía filtrar por negocio) y hay que decidir si se acepta.
   */
  perteneceAlNegocioActivo(negocioId: number | null | undefined): boolean {
    return negocioId === this.negocioIdRequerido();
  }

  /**
   * Falla de forma segura si el recurso no pertenece al negocio activo.
   *
   * El mensaje NO revela si el recurso existe en otro negocio: se comporta
   * igual que un recurso inexistente, para no permitir enumerar los datos de
   * otros negocios probando identificadores.
   */
  exigirPertenencia(negocioId: number | null | undefined): void {
    if (!this.perteneceAlNegocioActivo(negocioId)) {
      throw new ForbiddenException(
        'El recurso solicitado no está disponible en este negocio',
      );
    }
  }

  /**
   * Ejecuta `operacion` con el contexto del negocio indicado.
   *
   * Lo usan los PROCESOS DE FONDO que deben recorrer los negocios uno a uno
   * (por ejemplo, el cron de recordatorios de HU-11): en lugar de consultar
   * "las reservas de todos los negocios" de una vez, cada negocio se
   * consulta por separado, fijando su contexto, de modo que la capa de
   * aislamiento sigue siendo EFFECTIVA.
   *
   * No es un escape: el contexto se fija al negocio que se está recorriendo,
   * así que ninguna consulta sale de su ámbito.
   */
  ejecutarEnNegocio<T>(
    negocio: { id: number; slug: string },
    operacion: () => T,
  ): T {
    return this.contextoService.ejecutarEnContexto(negocio, operacion);
  }
}

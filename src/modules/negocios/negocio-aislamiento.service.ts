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
   * Obtiene el identificador numérico de la sede activa en el contexto.
   *
   * @returns ID del negocio activo.
   * @throws {ForbiddenException} Si la operación es tenant-scoped y no hay contexto validado.
   */
  negocioIdRequerido(): number {
    return this.contextoService.obtenerContextoRequerido().id;
  }

  /**
   * Enriquecedor de filtros `where` para lecturas en base de datos.
   *
   * @remarks
   * El filtro se integra en el `where` de la consulta, NO se aplica después
   * de recuperar la fila: así la base de datos nunca llega a devolver datos
   * de otro negocio, ni siquiera de forma temporal.
   *
   * @param where - Cláusula where original de Prisma.
   * @returns Cláusula where complementada con `negocioId`.
   */
  filtroLectura<T extends Record<string, unknown>>(
    where: T = {} as T,
  ): T & { negocioId: number } {
    return { ...where, negocioId: this.negocioIdRequerido() };
  }

  /**
   * Enriquecedor de filtros `where` para escrituras en base de datos (`update`, `delete`).
   *
   * @remarks
   * Incorpora el negocio a la MISMA cláusula `where` que identifica el
   * recurso, de modo que la fila solo se modifica si pertenece al negocio
   * activo. Si el recurso es de otro negocio, la operación no afecta a
   * ninguna fila (y el servicio detecta el cambio nulo).
   *
   * @param where - Cláusula where de la entidad.
   * @returns Cláusula where complementada con `negocioId`.
   */
  filtroEscritura<T extends Record<string, unknown>>(
    where: T = {} as T,
  ): T & { negocioId: number } {
    return { ...where, negocioId: this.negocioIdRequerido() };
  }

  /**
   * Comprueba si un ID de negocio coincide exactamente con el del contexto activo.
   *
   * @param negocioId - ID de negocio a evaluar.
   * @returns `true` si coincide con la sede activa.
   */
  perteneceAlNegocioActivo(negocioId: number | null | undefined): boolean {
    return negocioId === this.negocioIdRequerido();
  }

  /**
   * Falla de forma segura con 403 si el recurso no pertenece al negocio activo.
   *
   * @param negocioId - ID de negocio del recurso evaluado.
   * @throws {ForbiddenException} Si no pertenece a la sede activa.
   */
  exigirPertenencia(negocioId: number | null | undefined): void {
    if (!this.perteneceAlNegocioActivo(negocioId)) {
      throw new ForbiddenException(
        'El recurso solicitado no está disponible en este negocio',
      );
    }
  }

  /**
   * Ejecuta una rutina dentro del contexto explícito de un negocio dado.
   *
   * @remarks
   * Utilizado por tareas en segundo plano (crons de recordatorios, sincronización)
   * para iterar entre sedes manteniendo el aislamiento de datos.
   *
   * @param negocio - Par de identidad de la sede ({ id, slug }).
   * @param operacion - Función a ejecutar en dicho ámbito.
   * @returns Resultado de la operación.
   */
  ejecutarEnNegocio<T>(
    negocio: { id: number; slug: string },
    operacion: () => T,
  ): T {
    return this.contextoService.ejecutarEnContexto(negocio, operacion);
  }
}

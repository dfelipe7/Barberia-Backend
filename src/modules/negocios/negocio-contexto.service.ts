import { Injectable } from '@nestjs/common';
import {
  ContextoNegocio,
  ejecutarEnContextoNegocio,
  obtenerContextoNegocio,
  obtenerContextoNegocioRequerido,
  tieneContextoNegocio,
} from './negocio-almacenamiento';

export type { ContextoNegocio } from './negocio-almacenamiento';

/**
 * Contexto de negocio por petición, respaldado por `AsyncLocalStorage`.
 *
 * Por qué `AsyncLocalStorage` y no un servicio con estado mutable: el
 * contexto debe viajar con la CADENA ASÍNCRONA de la petición (controlador ->
 * servicio -> repositorio), incluidas las esperas (`await` intermedias), y
 * dos peticiones concurrentes NO pueden compartirlo. Un servicio con una
 * propiedad `negocioId` se cruzaría entre peticiones concurrentes.
 *
 * El contexto se establece con el MIDDLEWARE (`NegocioContextoMiddleware`),
 * no con un guard: un guard se ejecuta DESPUÉS de que el router ya ha
 * encadenado el resto de la petición, de modo que el `run()` de un guard no
 * abarca de forma fiable los tramos asíncronos posteriores. El middleware, en
 * cambio, envuelve la invocación de `next()` y por tanto todo el
 * procesamiento posterior.
 *
 * El almacén se comparte con la extensión de Prisma (ver
 * `negocio-almacenamiento.ts`) para que ambas capas vean el mismo contexto.
 */
@Injectable()
export class NegocioContextoService {
  /**
   * Ejecuta una operación sincrónica o asíncrona dentro del contexto de negocio establecido.
   *
   * @param contexto - Metadatos de la barbería activa (id, slug, estado)
   * @param operacion - Función a ejecutar que hereda el contexto en toda su cadena de promesas
   * @returns El resultado producido por la operación
   */
  ejecutarEnContexto<T>(contexto: ContextoNegocio, operacion: () => T): T {
    return ejecutarEnContextoNegocio(contexto, operacion);
  }

  /**
   * Devuelve el contexto de negocio activo en la traza de ejecución actual.
   *
   * @returns El contexto de la barbería resuelta o `undefined` si opera en ámbito global.
   */
  obtenerContexto(): ContextoNegocio | undefined {
    return obtenerContextoNegocio();
  }

  /**
   * Comprueba si la cadena asíncrona actual tiene un contexto de negocio asociado.
   *
   * @returns `true` si existe un negocio activo en el AsyncLocalStorage.
   */
  tieneContexto(): boolean {
    return tieneContextoNegocio();
  }

  /**
   * Devuelve el contexto de negocio activo o lanza una excepción defensiva si no existe.
   * Garantiza que operaciones críticas jamás operen sin aislamiento multitenant.
   *
   * @returns El contexto obligatorio de la barbería.
   * @throws {Error} Si se invoca fuera del ciclo de vida de una petición multitenant.
   */
  obtenerContextoRequerido(): ContextoNegocio {
    return obtenerContextoNegocioRequerido();
  }
}

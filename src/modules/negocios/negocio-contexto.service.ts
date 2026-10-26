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
   * Ejecuta `operacion` con el contexto de negocio establecido.
   *
   * Debe invocarse de forma que `next()` (o la operación equivalente) se
   * llame DENTRO de la callback: el resto de la cadena se registra en el
   * contexto asíncrono actual y hereda el negocio.
   */
  ejecutarEnContexto<T>(contexto: ContextoNegocio, operacion: () => T): T {
    return ejecutarEnContextoNegocio(contexto, operacion);
  }

  /** Devuelve el contexto de negocio activo, o `undefined` si no hay. */
  obtenerContexto(): ContextoNegocio | undefined {
    return obtenerContextoNegocio();
  }

  /** `true` si la cadena asíncrona actual tiene un contexto de negocio. */
  tieneContexto(): boolean {
    return tieneContextoNegocio();
  }

  /**
   * Devuelve el contexto de negocio activo o falla de forma segura.
   *
   * Se usa en las operaciones que DEBEN pertenecer a un negocio (lecturas y
   * escrituras tenant-scoped). Fallar aquí evita que una operación sin
   * contexto termine actuando sobre el conjunto completo de negocios.
   */
  obtenerContextoRequerido(): ContextoNegocio {
    return obtenerContextoNegocioRequerido();
  }
}

import { ForbiddenException, Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Identidad del negocio (tenant) activo en una petición.
 *
 * Se obtiene SIEMPRE del contexto validado por el servidor, nunca del cuerpo
 * de la petición. Un `negocioId` enviado por el cliente no es prueba de
 * autorización: el contexto se establece a partir del identificador PÚBLICO
 * del negocio (subdominio o cabecera `X-Negocio-Slug`) y se contrasta con la
 * pertenencia del usuario en las fases de autenticación.
 */
export interface ContextoNegocio {
  /** Identificador interno del negocio. */
  id: number;
  /** Identificador público y estable del negocio. */
  slug: string;
}

/**
 * Contexto de negocio por petición, respaldado por `AsyncLocalStorage`.
 *
 * Por qué `AsyncLocalStorage` y no un servicio con estado mutable: el
 * contexto debe viajar con la CADENA ASÍNCRONA de la petición (controlador ->
 * servicio -> repositorio), incluidas las esperas (`await`) intermedias, y
 * dos peticiones concurrentes NO pueden compartirlo. Un servicio con una
 * propiedad `negocioId` se cruzaría entre peticiones concurrentes.
 *
 * El contexto se establece con el MIDDLEWARE (`NegocioContextoMiddleware`),
 * no con un guard: un guard se ejecuta DESPUÉS de que el router ya ha
 * encadenado el resto de la petición, por lo que el `run()` de un guard no
 * abarca de forma fiable los tramos asíncronos posteriores. El middleware, en
 * cambio, envuelve la invocación de `next()` y por tanto todo el
 * procesamiento posterior.
 */
@Injectable()
export class NegocioContextoService {
  private readonly almacenamiento = new AsyncLocalStorage<ContextoNegocio>();

  /**
   * Ejecuta `operacion` con el contexto de negocio establecido.
   *
   * Debe invocarse de forma que `next()` (o la operación equivalente) se
   * llame DENTRO de la callback: el resto de la cadena se registra en el
   * contexto asíncrono actual y hereda el negocio.
   */
  ejecutarEnContexto<T>(contexto: ContextoNegocio, operacion: () => T): T {
    return this.almacenamiento.run(contexto, operacion);
  }

  /** Devuelve el contexto de negocio activo, o `undefined` si no hay. */
  obtenerContexto(): ContextoNegocio | undefined {
    return this.almacenamiento.getStore();
  }

  /** `true` si la cadena asíncrona actual tiene un contexto de negocio. */
  tieneContexto(): boolean {
    return this.almacenamiento.getStore() !== undefined;
  }

  /**
   * Devuelve el contexto de negocio activo o falla de forma segura.
   *
   * Se usa en las operaciones que DEBEN pertenecer a un negocio (lecturas y
   * escrituras tenant-scoped). Fallar aquí evita que una operación sin
   * contexto termine acting sobre el conjunto completo de negocios.
   */
  obtenerContextoRequerido(): ContextoNegocio {
    const contexto = this.almacenamiento.getStore();

    if (!contexto) {
      throw new ForbiddenException(
        'La operación requiere un contexto de negocio autorizado',
      );
    }

    return contexto;
  }
}

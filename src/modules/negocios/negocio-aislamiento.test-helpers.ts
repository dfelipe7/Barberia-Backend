import { ForbiddenException } from '@nestjs/common';
import {
  ContextoNegocio,
  ContextoNegocioAlmacenamiento,
} from './negocio-almacenamiento';
import { NegocioAislamientoService } from './negocio-aislamiento.service';
import { NegocioContextoService } from './negocio-contexto.service';

/**
 * Datos de negocio usados en las pruebas de aislamiento.
 */
export const NEGOCIO_A = 1;
export const NEGOCIO_B = 2;

export const CONTEXTO_NEGOCIO_A: ContextoNegocio = {
  id: NEGOCIO_A,
  slug: 'negocio-a',
};

export const CONTEXTO_NEGOCIO_B: ContextoNegocio = {
  id: NEGOCIO_B,
  slug: 'negocio-b',
};

/**
 * Crea un `NegocioAislamientoService` que opera con el contexto indicado.
 *
 * Las pruebas de repositorio se ejecutan FUERA de una petición HTTP, así que
 * no hay middleware que establezca el contexto. Esta ayudante lo fija de
 * forma explícita y EXPLÍCITA, de modo que el repositorio se prueba en el
 * mismo estado en que tendría en producción (contexto de negocio presente).
 *
 * Para las pruebas que necesitan el mecanismo real de `AsyncLocalStorage`
 * (la extensión de Prisma, el aislamiento entre peticiones concurrentes) se
 * usa `establecerContextoNegocio` dentro del propio caso de prueba.
 */
export function crearAislamientoNegocio(
  contexto: ContextoNegocio = CONTEXTO_NEGOCIO_A,
): NegocioAislamientoService {
  return new NegocioAislamientoService(crearContextoServiceFijado(contexto));
}

/**
 * Crea un `NegocioAislamientoService` SIN contexto de negocio.
 *
 * Sirve para comprobar el comportamiento fail-closed: una operación
 * tenant-scoped sin contexto debe fallar, no devolver datos de todos los
 * negocios.
 */
export function crearAislamientoSinContexto(): NegocioAislamientoService {
  return new NegocioAislamientoService(crearContextoServiceFijado(undefined));
}

/**
 * Fija el contexto de negocio en la cadena asíncrona actual.
 *
 * Se usa `enterWith` porque el contexto debe cubrir el resto de la
 * operación asíncrona (no solo una callback). Debe usarse DENTRO del caso de
 * prueba: desde un `beforeEach` el contexto no se propaga al cuerpo del test.
 */
export function establecerContextoNegocio(contexto: ContextoNegocio): void {
  ContextoNegocioAlmacenamiento.enterWith(contexto);
}

/** Limpia el contexto de negocio entre pruebas. */
export function limpiarContextoNegocio(): void {
  ContextoNegocioAlmacenamiento.disable();
}

/**
 * Servicio de contexto que devuelve siempre el mismo contexto.
 *
 * Se construye a mano (y no con el contenedor de Nest) para que las pruebas
 * de repositorio no dependan del grafo de inyección de dependencias.
 */
function crearContextoServiceFijado(
  contexto: ContextoNegocio | undefined,
): NegocioContextoService {
  return {
    ejecutarEnContexto: <T>(_c: ContextoNegocio, operacion: () => T): T =>
      operacion(),
    obtenerContexto: () => contexto,
    tieneContexto: () => contexto !== undefined,
    obtenerContextoRequerido: () => {
      if (!contexto) {
        // Mismo tipo de fallo que el servicio real: `ForbiddenException`.
        throw new ForbiddenException(
          'La operación requiere un contexto de negocio autorizado',
        );
      }
      return contexto;
    },
  };
}

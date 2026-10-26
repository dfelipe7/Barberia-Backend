import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException } from '@nestjs/common';

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
 * Almacén del contexto de negocio, compartido por TODOS los consumidores.
 *
 * POR QUÉ ES UN SINGLETON DE MÓDULO Y NO UN SERVICIO INYECTABLE:
 * la extensión de Prisma se construye en el constructor de `PrismaService`,
 * fuera del contenedor de dependencias de Nest. Para que la extensión y
 * `NegocioContextoService` compartan EXACTAMENTE el mismo almacén (y por
 * tanto el mismo contexto), el `AsyncLocalStorage` vive en este módulo.
 *
 * `AsyncLocalStorage` es un singleton por naturaleza: dos instancias
 * distintas NO compartirían el contexto, y el aislamiento fallaría en
 * silencio. Centralizarlo aquí evita ese error.
 */
export const ContextoNegocioAlmacenamiento =
  new AsyncLocalStorage<ContextoNegocio>();

/**
 * Ejecuta `operacion` con el contexto de negocio establecido.
 *
 * Debe invocarse de forma que `next()` (o la operación equivalente) se
 * llame DENTRO de la callback: el resto de la cadena se registra en el
 * contexto asíncrono actual y hereda el negocio.
 */
export function ejecutarEnContextoNegocio<T>(
  contexto: ContextoNegocio,
  operacion: () => T,
): T {
  return ContextoNegocioAlmacenamiento.run(contexto, operacion);
}

/** Devuelve el contexto de negocio activo, o `undefined` si no hay. */
export function obtenerContextoNegocio(): ContextoNegocio | undefined {
  return ContextoNegocioAlmacenamiento.getStore();
}

/** `true` si la cadena asíncrona actual tiene un contexto de negocio. */
export function tieneContextoNegocio(): boolean {
  return obtenerContextoNegocio() !== undefined;
}

/**
 * Devuelve el contexto de negocio activo o falla de forma segura.
 *
 * Se usa en las operaciones que DEBEN pertenecer a un negocio (lecturas y
 * escrituras tenant-scoped). Fallar aquí evita que una operación sin
 * contexto termine actuando sobre el conjunto completo de negocios.
 */
export function obtenerContextoNegocioRequerido(): ContextoNegocio {
  const contexto = obtenerContextoNegocio();

  if (!contexto) {
    throw new ForbiddenException(
      'La operación requiere un contexto de negocio autorizado',
    );
  }

  return contexto;
}

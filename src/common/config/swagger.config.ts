/**
 * Disponibilidad de la documentación Swagger (OpenAPI).
 *
 * Se separa de `main.ts` para poder PROBARLA: `main.ts` es un arranque de
 * proceso y no es importable desde las pruebas.
 *
 * REGLA
 * -----
 * - En desarrollo (y en cualquier entorno que no sea `production`) la
 *   documentación se publica: es necesaria para trabajar y para el frontend.
 * - En `production` NO se publica por defecto (expone la superficie completa de
 *   la API). Se puede habilitar de forma explícita con
 *   `SWAGGER_HABILITADO=true` si el operador decide que su exposição es
 *   aceptable (por ejemplo, en un entorno interno).
 */

/** Variable de entorno que habilita o deshabilita Swagger de forma explícita. */
export const SWAGGER_HABILITADO_ENV = 'SWAGGER_HABILITADO';

/**
 * Indica si la documentación Swagger debe publicarse.
 *
 * Precedencia: `SWAGGER_HABILITADO` (explícito) > `NODE_ENV` (por defecto).
 */
export function swaggerHabilitado(
  entorno: Record<string, string | undefined> = process.env,
): boolean {
  const flag = entorno[SWAGGER_HABILITADO_ENV]?.trim().toLowerCase();

  if (flag === 'true') {
    return true;
  }

  if (flag === 'false') {
    return false;
  }

  return entorno.NODE_ENV?.trim().toLowerCase() !== 'production';
}

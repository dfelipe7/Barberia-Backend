/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: decidir si el simulador de error 500 puede ejecutarse en el entorno actual.
 * - Responsabilidad: regla de habilitación por entorno. No autoriza personas ni conoce rutas.
 */

/**
 * Variable que habilita explícitamente el simulador de error 500.
 *
 * El simulador existe para comprobar la cadena de alertas por correo. Es una
 * herramienta de diagnóstico: si queda activa en producción, cualquiera que
 * la alcance genera correos de alerta al responsable de seguridad.
 */
export const SIMULADOR_ERROR_HABILITADO_ENV = 'SIMULADOR_ERROR_HABILITADO';

/**
 * Regla de habilitación del simulador de error 500.
 *
 * Precedencia:
 *  1. En producción (`NODE_ENV=production`) NUNCA se habilita, aunque se pida
 *     explícitamente: es la única forma de garantizar que el diagnóstico no
 *     exista en el entorno real.
 *  2. Fuera de producción hace falta habilitación explícita
 *     (`SIMULADOR_ERROR_HABILITADO=true`).
 *
 * @param entorno Variables de entorno (por defecto `process.env`).
 * @returns `true` solo si el simulador puede ejecutarse.
 */
export function simuladorErrorHabilitado(
  entorno: Record<string, string | undefined> = process.env,
): boolean {
  if (entorno.NODE_ENV?.trim().toLowerCase() === 'production') {
    return false;
  }

  return (
    entorno[SIMULADOR_ERROR_HABILITADO_ENV]?.trim().toLowerCase() === 'true'
  );
}

/**
 * Constantes de aislamiento de la sesión de cliente (HE-04, Modalidad B).
 *
 * La sesión de cliente es deliberadamente INDEPENDIENTE de la del personal:
 * - Se firma con un secreto propio (`JWT_CLIENTE_SECRET`), NUNCA con `JWT_SECRET`.
 * - Lleva la marca `tipo = CLIENTE` para que un token de cliente jamás sea
 *   aceptado por los guards del personal, ni viceversa.
 * - Usa una audiencia propia (`barberia-clientes`) que los tokens de personal no
 *   tienen, como segunda barrera frente a una mala configuración de secretos.
 */

/** Variable de entorno con el secreto exclusivo de los tokens de cliente. */
export const JWT_CLIENTE_SECRET_ENV = 'JWT_CLIENTE_SECRET';

/** Valor de la reclamación `tipo` que identifica un token de cliente. */
export const TIPO_TOKEN_CLIENTE = 'CLIENTE';

/** Audiencia exclusiva de los tokens de cliente. */
export const AUDIENCIA_CLIENTE = 'barberia-clientes';

/** Vigencia de la sesión de cliente (los clientes reservan de forma esporádica). */
export const EXPIRACION_TOKEN_CLIENTE = '30d';

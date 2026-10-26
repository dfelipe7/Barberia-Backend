/**
 * Formato de la clave de idempotencia (`Idempotency-Key`).
 *
 * Contrato: **UUID v4**. Es un valor que el cliente genera (no el servidor) y
 * que identifica UN intento de reserva. Se exige la versión 4 y la variante
 * correcta para que no se acepten claves mal formadas que colisionarían.
 */
export const REGEX_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

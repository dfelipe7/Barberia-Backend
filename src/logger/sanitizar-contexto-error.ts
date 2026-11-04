/**
 * Trazabilidad:
 * - REQ: REQ-009, REQ-010
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: construir el contexto de error que se registra y se envía por correo sin credenciales.
 * - Responsabilidad: funciones de saneamiento (ruta, query y contexto). No registra ni envía nada.
 */

/**
 * Marcador que sustituye a cualquier valor que pueda ser una credencial.
 */
export const VALOR_REDACTADO = '[redactado]';

/**
 * Nombres de parámetro de query que NUNCA se registran en claro.
 *
 * El objetivo no es solo el token: también los códigos de un solo uso y las
 * claves de API viajan a veces en la query string, y la query string acaba en
 * los registros de acceso del proxy y del servidor web.
 *
 * `key` se reconoce solo cuando es el nombre completo o va delimitado por `-`
 * o `_` (`key`, `x-key`, `api_key`): así se redacta sin castigar nombres
 * inocuos que lo contengan (`sortKey`).
 */
const PARAMETRO_SENSIBLE =
  /(?:token|clave|pass|contrase|secret|ses|auth|cookie|cod|access|refresh|api[-_]?key|(?:^|[_-])key(?:[_-]|$))/i;

/**
 * Valor que parece una credencial: fragmento largo en base64/hex.
 *
 * Se exige una longitud mínima de 24 caracteres para no redactar identificadores
 * legítimos (un id de negocio o de reserva es numérico y corto).
 */
const VALOR_SENSIBLE = /^[A-Za-z0-9_\-.=+/]{24,}$/;

/**
 * Segmento de ruta que parece una credencial (token en la URL).
 */
const SEGMENTO_SENSIBLE = /^[A-Za-z0-9_-]{24,}$/;

/** Un identificador numérico no es una credencial, por muy largo que sea. */
const SOLO_DIGITOS = /^\d+$/;

/**
 * Redacta un segmento de la ruta.
 *
 * @param segmento Segmento de la ruta (sin barras).
 * @returns El mismo segmento o el marcador de redacción.
 */
export function redactarSegmento(segmento: string): string {
  if (!segmento) {
    return segmento;
  }
  if (SEGMENTO_SENSIBLE.test(segmento) && !SOLO_DIGITOS.test(segmento)) {
    return VALOR_REDACTADO;
  }
  return segmento;
}

/**
 * Redacta un parámetro de la query string.
 *
 * Se redacta el valor cuando el NOMBRE del parámetro es sensible o cuando el
 * valor tiene forma de credencial, aunque el nombre sea inocuo.
 *
 * @param parametro Parámetro completo `nombre=valor`.
 * @returns El parámetro con el valor saneado.
 */
export function redactarParametro(parametro: string): string {
  const separador = parametro.indexOf('=');
  if (separador < 0) {
    return parametro;
  }

  const nombre = parametro.slice(0, separador);
  const valor = parametro.slice(separador + 1);

  if (
    PARAMETRO_SENSIBLE.test(nombre) ||
    (valor && VALOR_SENSIBLE.test(valor))
  ) {
    return `${nombre}=${VALOR_REDACTADO}`;
  }

  return parametro;
}

/**
 * Sanea la ruta de la petición para poder registrarla.
 *
 * - Redacta los segmentos que parecen credenciales.
 * - Redacta los valores sensibles de la query string, conservando el nombre
 *   del parámetro para no perder el contexto operativo.
 *
 * @param url Ruta completa de la petición (`request.url`).
 * @returns Ruta apta para registro.
 */
export function sanearRuta(url: string | undefined): string {
  if (!url) {
    return '';
  }

  const [ruta, query] = url.split('?', 2);
  const rutaSaneada = ruta.split('/').map(redactarSegmento).join('/');

  if (!query) {
    return rutaSaneada;
  }

  const querySaneada = query.split('&').map(redactarParametro).join('&');

  return `${rutaSaneada}?${querySaneada}`;
}

/**
 * Petición de la que solo se leen campos que NO pueden contener credenciales.
 *
 * Deliberadamente **no** incluye `body`, `headers` ni `cookies`: el contexto
 * seguro se construye sin ellos.
 */
export interface PeticionSeguro {
  url?: string;
  method?: string;
  ip?: string;
  user?: { email?: string; sub?: string };
}

/**
 * Contexto operativo que se registra y se envía por correo de alerta.
 *
 * NO contiene el cuerpo de la petición: es el campo donde viajan el ID token
 * de Google, las contraseñas y los datos de acceso. Tampoco contiene
 * cabeceras, cookies ni ningún valor de autenticación.
 */
export interface ContextoErrorSeguro {
  /** Momento del error en ISO 8601. */
  timestamp: string;
  /** Método HTTP de la petición. */
  method: string;
  /** Ruta saneada (sin credenciales). */
  path: string;
  /** Código de estado de la respuesta. */
  status: number;
  /** Identificador de la petición, para correlacionar log, correo y respuesta. */
  requestId: string;
  /** Código de error de dominio, cuando la excepción lo aporta. */
  codigoError?: string;
  /** IP de origen. */
  ip?: string;
  /** Identidad de la persona autenticada, si la había. */
  user?: string;
  /** Mensaje de la excepción. */
  message: unknown;
}

/**
 * Construye el contexto seguro de un error.
 *
 * @param request Petición HTTP (solo se leen método, url, ip y la identidad).
 * @param datos Estado, mensaje, código de error e identificador de petición.
 * @returns Contexto sin datos sensibles.
 */
export function construirContextoSeguro(
  request: PeticionSeguro,
  datos: {
    status: number;
    message: unknown;
    codigoError?: string;
    requestId: string;
  },
): ContextoErrorSeguro {
  const identidad = request.user?.email || request.user?.sub;

  return {
    timestamp: new Date().toISOString(),
    method: request.method ?? '',
    path: sanearRuta(request.url),
    status: datos.status,
    requestId: datos.requestId,
    ...(datos.codigoError === undefined
      ? {}
      : { codigoError: datos.codigoError }),
    ...(identidad ? { user: identidad } : {}),
    ...(request.ip ? { ip: request.ip } : {}),
    message: datos.message,
  };
}

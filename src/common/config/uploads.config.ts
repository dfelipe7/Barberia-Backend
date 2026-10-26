import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Configuración del almacenamiento de archivos subidos (Fase 15).
 *
 * DIRECTORIO RAÍZ
 * ---------------
 * `UPLOADS_DIR` fija dónde viven los archivos. Si no se define, se usa
 * `<cwd>/uploads` (el comportamiento histórico de la aplicación).
 *
 * En Docker el directorio DEBE ser un VOLUMEN PERSISTENTE: el sistema de
 * ficheros del contenedor es efímero y los archivos se perderían en cada
 * redeploy. En Railway hay que montar un volumen en `UPLOADS_DIR` (o usar un
 * adaptador de objetos): escribir dentro del contenedor NO persiste.
 *
 * RUTAS PÚBLICAS
 * --------------
 * Los archivos se sirven bajo el prefijo `/uploads`. Lo que se guarda en la
 * base de datos es SIEMPRE una ruta PÚBLICA relativa: nunca una ruta
 * absoluta del sistema de ficheros.
 */

/** Variable de entorno que fija el directorio de archivos subidos. */
export const UPLOADS_DIR_ENV = 'UPLOADS_DIR';

/** Prefijo público con el que se sirven los archivos subidos. */
export const PREFIJO_PUBLICO_UPLOADS = '/uploads';

/** Carpeta raíz (dentro de `UPLOADS_DIR`) que agrupa los archivos de negocio. */
export const CARPETA_NEGOCIOS = 'negocios';

/** Subcarpeta, dentro del negocio, que guarda los recursos de marca. */
export const CARPETA_PERFIL = 'perfil';

/**
 * Directorio raíz de los archivos subidos.
 *
 * Se resuelve en cada llamada (no se cachea) para que las pruebas puedan
 * cambiar `UPLOADS_DIR` de forma aislada.
 */
export function directorioUploads(
  entorno: Record<string, string | undefined> = process.env,
): string {
  const configurado = entorno[UPLOADS_DIR_ENV]?.trim();

  if (!configurado) {
    return join(process.cwd(), 'uploads');
  }

  return isAbsolute(configurado)
    ? resolve(configurado)
    : resolve(process.cwd(), configurado);
}

/**
 * Directorio de archivos de un negocio.
 *
 * El `negocioId` SIEMPRE viene del contexto autorizado del servidor: cada
 * barbería tiene su propio espacio y no puede leer ni escribir en el de otra.
 */
export function directorioNegocio(
  negocioId: number,
  entorno?: Record<string, string | undefined>,
): string {
  return join(directorioUploads(entorno), CARPETA_NEGOCIOS, String(negocioId));
}

/** Directorio de los recursos de marca de un negocio. */
export function directorioPerfilNegocio(
  negocioId: number,
  entorno?: Record<string, string | undefined>,
): string {
  return join(directorioNegocio(negocioId, entorno), CARPETA_PERFIL);
}

/**
 * Comprueba que una ruta ABSOLUTA de disco está dentro del directorio de
 * perfil del negocio indicado.
 *
 * Es la barrera contra el path traversal: un recurso solo se borra si el
 * fichero está realmente en el espacio del negocio. Se comparan las rutas
 * ya resueltas, no las cadenas.
 */
export function estaDentroDelPerfil(
  rutaAbsoluta: string,
  negocioId: number,
  entorno?: Record<string, string | undefined>,
): boolean {
  const base = resolve(directorioPerfilNegocio(negocioId, entorno));
  const relativa = relative(base, resolve(rutaAbsoluta));

  return (
    relativa !== '' &&
    !relativa.startsWith('..') &&
    !relativa.startsWith(`..${sep}`) &&
    !isAbsolute(relativa)
  );
}

/**
 * Cabeceras de seguridad al servir archivos subidos.
 *
 * El contenido público de una barbería (logos, banners, favicons) se sirve
 * con un tipo MIME coherente con su extensión. Además:
 *
 * - `X-Content-Type-Options: nosniff` impide que el navegador interprete el
 *   archivo con un tipo distinto del declarado.
 * - `Content-Security-Policy` con `default-src 'none'` y `sandbox` impide
 *   que un SVG servido desde el mismo origen ejecute script o cargue
 *   recursos externos. Es la contraparte de servir SVG: aunque el archivo se
 *   sanea al subirlo, el navegador no debe confiar en él.
 */
export function cabecerasSeguridadUploads(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

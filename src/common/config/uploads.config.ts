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

/** Subcarpeta, dentro del negocio, que guarda las imágenes de productos. */
export const CARPETA_PRODUCTOS = 'productos';

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

/** Directorio de las imágenes de productos de un negocio. */
export function directorioProductosNegocio(
  negocioId: number,
  entorno?: Record<string, string | undefined>,
): string {
  return join(directorioNegocio(negocioId, entorno), CARPETA_PRODUCTOS);
}

/**
 * Comprueba que una ruta ABSOLUTA de disco está dentro de un directorio base.
 *
 * Es la barrera contra el path traversal: un recurso solo se borra si el
 * fichero está realmente dentro del espacio esperado. Se comparan las rutas
 * ya resueltas, no las cadenas.
 */
function estaDentroDe(rutaAbsoluta: string, base: string): boolean {
  const relativa = relative(resolve(base), resolve(rutaAbsoluta));

  return (
    relativa !== '' &&
    !relativa.startsWith('..') &&
    !relativa.startsWith(`..${sep}`) &&
    !isAbsolute(relativa)
  );
}

/**
 * Comprueba que una ruta ABSOLUTA de disco está dentro del directorio de
 * perfil del negocio indicado.
 */
export function estaDentroDelPerfil(
  rutaAbsoluta: string,
  negocioId: number,
  entorno?: Record<string, string | undefined>,
): boolean {
  return estaDentroDe(
    rutaAbsoluta,
    directorioPerfilNegocio(negocioId, entorno),
  );
}

/** Comprueba que una ruta ABSOLUTA está dentro de los productos del negocio. */
export function estaDentroDeProductos(
  rutaAbsoluta: string,
  negocioId: number,
  entorno?: Record<string, string | undefined>,
): boolean {
  return estaDentroDe(
    rutaAbsoluta,
    directorioProductosNegocio(negocioId, entorno),
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

/**
 * Resuelve la ruta pública relativa de un archivo subido a través de Multer.
 * Si el archivo fue guardado dentro de una subcarpeta de negocio (ej. `/uploads/negocios/1/barberos/foto.jpg`),
 * retorna esa ruta pública. Si fue guardado en la carpeta global histórica, retorna `/uploads/{carpeta}/{filename}`.
 */
export function resolverRutaPublicaUpload(
  archivo: Express.Multer.File,
  carpetaFallback: string,
): string {
  if (archivo.destination) {
    const rootUploads = directorioUploads(process.env);
    const rel = relative(rootUploads, archivo.destination).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..')) {
      return `${PREFIJO_PUBLICO_UPLOADS}/${rel}/${archivo.filename}`;
    }
  }
  return `${PREFIJO_PUBLICO_UPLOADS}/${carpetaFallback}/${archivo.filename}`;
}

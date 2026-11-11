/**
 * Detección del TIPO REAL de un archivo a partir de su CONTENIDO.
 *
 * POR QUÉ NO BASTA EL `Content-Type` DEL CLIENTE
 * ----------------------------------------------
 * El `Content-Type` de la petición (y la extensión del nombre) los elige el
 * cliente: son completamente controlables. Un atacante puede enviar un script
 * declarando `image/png`. Por eso el tipo se deduce de la FIRMA del
 * contenido (magic bytes) y no de lo que dice la petición.
 *
 * Formatos admitidos en los recursos de marca:
 * - `png`: banner. Firma binaria `89 50 4E 47 0D 0A 1A 0A` y primer chunk
 *   `IHDR` (obligatorio por la especificación PNG).
 * - `svg`: favicon y logos. Texto XML cuyo primer elemento es `<svg>`.
 *
 * Formatos admitidos en las imágenes de productos:
 * - `jpeg`: firma `FF D8 FF`.
 * - `png`: misma firma que arriba.
 * - `webp`: contenedor `RIFF....WEBP`.
 *
 * SVG NO se admite en productos: se sirve desde el mismo origen y puede
 * ejecutar scripts.
 */

/** Tipos de archivo que la aplicación reconoce por su contenido. */
export type TipoArchivo = 'png' | 'jpeg' | 'webp' | 'svg' | 'desconocido';

/** Firma binaria de un fichero PNG. */
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Firma binaria del inicio de un fichero JPEG. */
const FIRMA_JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/** Etiqueta del primer chunk de un PNG (obligatorio: `IHDR`). */
const PRIMER_CHUNK_PNG = 'IHDR';

/**
 * Indica si el contenido es un PNG válido.
 *
 * Se comprueba la firma y que el primer chunk sea `IHDR`: así un fichero
 * HTML con la firma PNG pegada al principio no se acepta como imagen.
 */
export function esPng(contenido: Buffer): boolean {
  if (contenido.length < 16) {
    return false;
  }

  if (!contenido.subarray(0, FIRMA_PNG.length).equals(FIRMA_PNG)) {
    return false;
  }

  return contenido.subarray(12, 16).toString('latin1') === PRIMER_CHUNK_PNG;
}

/**
 * Indica si el contenido es un SVG (texto XML con `<svg>` como primer
 * elemento).
 */
export function esSvg(contenido: Buffer): boolean {
  const texto = contenido
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trimStart();

  return /^<svg[\s/>]/i.test(texto);
}

/**
 * Indica si el contenido es un JPEG (firma `FF D8 FF`).
 */
export function esJpeg(contenido: Buffer): boolean {
  return (
    contenido.length >= FIRMA_JPEG.length &&
    contenido.subarray(0, FIRMA_JPEG.length).equals(FIRMA_JPEG)
  );
}

/**
 * Indica si el contenido es un WEBP (contenedor RIFF con marca WEBP).
 */
export function esWebp(contenido: Buffer): boolean {
  if (contenido.length < 12) {
    return false;
  }

  return (
    contenido.subarray(0, 4).toString('latin1') === 'RIFF' &&
    contenido.subarray(8, 12).toString('latin1') === 'WEBP'
  );
}

/**
 * Detecta el tipo real del archivo a partir de su contenido.
 *
 * @returns `png`, `jpeg`, `webp`, `svg` o `desconocido`.
 */
export function detectarTipoArchivo(contenido: Buffer): TipoArchivo {
  if (esPng(contenido)) {
    return 'png';
  }

  if (esJpeg(contenido)) {
    return 'jpeg';
  }

  if (esWebp(contenido)) {
    return 'webp';
  }

  if (esSvg(contenido)) {
    return 'svg';
  }

  return 'desconocido';
}

/**
 * Tipo MIME que corresponde al tipo detectado.
 *
 * Se usa para servir el archivo con el tipo correcto, no el que declara el
 * cliente.
 */
export function mimeDeTipoArchivo(tipo: TipoArchivo): string {
  switch (tipo) {
    case 'png':
      return 'image/png';
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

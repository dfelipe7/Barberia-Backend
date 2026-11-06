/**
 * Límites del producto (HE-03-HU-01).
 *
 * Coinciden con las columnas de `prisma/schema.prisma` para que el DTO no
 * admita un valor que la base de datos vaya a truncar o rechazar.
 */

/** Longitud máxima del nombre. */
export const LIMITE_NOMBRE_PRODUCTO = 100;

/** Longitud máxima de la descripción. */
export const LIMITE_DESCRIPCION_PRODUCTO = 500;

/** Precio mínimo admitido: estrictamente mayor que cero. */
export const PRECIO_MINIMO_PRODUCTO = 0.01;

/** Precio máximo admitido por `DECIMAL(10,2)`. */
export const PRECIO_MAXIMO_PRODUCTO = 99_999_999.99;

/** Tamaño máximo de la imagen del producto: 5 MB. */
export const LIMITE_BYTES_IMAGEN_PRODUCTO = 5 * 1024 * 1024;

/** Formatos de imagen admitidos, detectados por el CONTENIDO. */
export const FORMATOS_IMAGEN_PRODUCTO = ['jpeg', 'png', 'webp'] as const;

/** Mensaje único para imagen inválida (no revela detalles del archivo). */
export const MENSAJE_IMAGEN_INVALIDA =
  'La imagen debe ser un archivo JPG, PNG o WEBP válido de máximo 5 MB';

/** Mensaje para nombre duplicado dentro del mismo negocio. */
export const MENSAJE_NOMBRE_DUPLICADO =
  'Ya existe un producto con este nombre en este negocio';

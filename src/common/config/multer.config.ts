import { BadRequestException } from '@nestjs/common';
import { diskStorage, memoryStorage } from 'multer';
import { extname, join } from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { CARPETA_NEGOCIOS, directorioUploads } from './uploads.config';
import { obtenerContextoNegocio } from '../../modules/negocios/negocio-almacenamiento';

interface PeticionConNegocio extends Express.Request {
  negocioId?: number;
  negocio?: { id?: number };
}

/**
 * Fábrica de configuración reutilizable para Multer.
 *
 * Principio de Arquitectura Limpia:
 * Centraliza la lógica del sistema de archivos (almacenamiento, generación de nombres seguros,
 * validación de tipos MIME y cuotas de tamaño) fuera de los controladores.
 * Permite que los controladores actúen como capas delgadas (Thin Controllers) dedicadas solo
 * a la orquestación HTTP.
 *
 * Aislamiento Multitenant:
 * Si la petición se ejecuta dentro del contexto de una sede (AsyncLocalStorage o req),
 * los archivos se alojan en su carpeta aislada: `<uploads>/negocios/{negocioId}/{carpetaDestino}/`.
 *
 * @param carpetaDestino Subcarpeta dentro de /uploads/ (ej. 'servicios', 'barberos', 'productos')
 * @param prefijoArchivo Prefijo opcional para el nombre del archivo (ej. 'servicio', 'barbero')
 */
export const crearMulterOptions = (
  carpetaDestino: string,
  prefijoArchivo?: string,
) => {
  const prefijo =
    prefijoArchivo ||
    (carpetaDestino.endsWith('s')
      ? carpetaDestino.slice(0, -1)
      : carpetaDestino);

  return {
    storage: diskStorage({
      destination: (req, _file, callback) => {
        const rootUploads = directorioUploads(process.env);
        const contexto = obtenerContextoNegocio();
        const peticion = req as PeticionConNegocio | null | undefined;
        const negocioId =
          contexto?.id ?? peticion?.negocioId ?? peticion?.negocio?.id;

        const uploadPath = negocioId
          ? join(
              rootUploads,
              CARPETA_NEGOCIOS,
              String(negocioId),
              carpetaDestino,
            )
          : join(rootUploads, carpetaDestino);

        // Crea automáticamente el directorio en disco si no existe
        if (!fs.existsSync(uploadPath)) {
          fs.mkdirSync(uploadPath, { recursive: true });
        }
        callback(null, uploadPath);
      },
      filename: (_req, file, callback) => {
        // Sanitiza y genera un nombre criptográficamente único con timestamp para evitar colisiones o sobrescrituras
        const randomSuffix =
          Date.now() + '-' + crypto.randomBytes(8).toString('hex');
        const extension = extname(file.originalname).toLowerCase();
        callback(null, `${prefijo}-${randomSuffix}${extension}`);
      },
    }),
    fileFilter: (
      _req: unknown,
      file: Express.Multer.File,
      callback: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      // OWASP A08: Validación estricta de extensiones y tipos MIME para mitigar cargas maliciosas (.php, .exe, .sh)
      if (!/\/(jpg|jpeg|png|webp)$/.test(file.mimetype)) {
        callback(
          new BadRequestException(
            'Formato de archivo no permitido. Solo se aceptan imágenes JPG, JPEG, PNG o WEBP',
          ),
          false,
        );
        return;
      }
      callback(null, true);
    },
    limits: {
      // Límite de tamaño máximo: 5 MB por archivo
      fileSize: 5 * 1024 * 1024,
    },
  };
};

/**
 * Opciones de Multer para cargas que se VALIDAN ANTES de tocar el disco.
 *
 * El archivo se recibe EN MEMORIA y no se escribe en ningún sitio hasta que
 * la aplicación ha comprobado su contenido real (firma), su formato y su
 * tamaño, y ha generado un nombre propio. Un archivo no válido nunca llega
 * al sistema de ficheros.
 *
 * @param limiteBytes Tamaño máximo admitido.
 */
export const crearMulterMemoryOptions = (limiteBytes: number) => ({
  storage: memoryStorage(),
  limits: {
    fileSize: limiteBytes,
    files: 1,
  },
});

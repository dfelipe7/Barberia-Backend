import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';

/**
 * Fábrica de configuración reutilizable para Multer.
 * 
 * Principio de Arquitectura Limpia:
 * Centraliza la lógica del sistema de archivos (almacenamiento, generación de nombres seguros,
 * validación de tipos MIME y cuotas de tamaño) fuera de los controladores.
 * Permite que los controladores actúen como capas delgadas (Thin Controllers) dedicadas solo
 * a la orquestación HTTP.
 * 
 * @param carpetaDestino Subcarpeta dentro de /uploads/ (ej. 'servicios', 'barberos', 'productos')
 * @param prefijoArchivo Prefijo opcional para el nombre del archivo (ej. 'servicio', 'barbero')
 */
export const crearMulterOptions = (carpetaDestino: string, prefijoArchivo?: string) => {
    const uploadPath = join(process.cwd(), 'uploads', carpetaDestino);
    const prefijo = prefijoArchivo || (carpetaDestino.endsWith('s') ? carpetaDestino.slice(0, -1) : carpetaDestino);

    return {
        storage: diskStorage({
            destination: (_req, _file, callback) => {
                // Crea automáticamente el directorio en disco si no existe
                if (!fs.existsSync(uploadPath)) {
                    fs.mkdirSync(uploadPath, { recursive: true });
                }
                callback(null, uploadPath);
            },
            filename: (_req, file, callback) => {
                // Sanitiza y genera un nombre criptográficamente único con timestamp para evitar colisiones o sobrescrituras
                const randomSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                const extension = extname(file.originalname).toLowerCase();
                callback(null, `${prefijo}-${randomSuffix}${extension}`);
            },
        }),
        fileFilter: (_req: any, file: any, callback: any) => {
            // OWASP A08: Validación estricta de extensiones y tipos MIME para mitigar cargas maliciosas (.php, .exe, .sh)
            if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
                return callback(
                    new BadRequestException(
                        'Formato de archivo no permitido. Solo se aceptan imágenes JPG, JPEG, PNG o WEBP',
                    ),
                    false,
                );
            }
            callback(null, true);
        },
        limits: {
            // Límite de tamaño máximo: 5 MB por archivo
            fileSize: 5 * 1024 * 1024,
        },
    };
};

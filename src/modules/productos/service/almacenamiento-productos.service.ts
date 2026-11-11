import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  directorioProductosNegocio,
  directorioUploads,
  estaDentroDeProductos,
  PREFIJO_PUBLICO_UPLOADS,
} from '../../../common/config/uploads.config';

const PERMISOS_DIRECTORIO = 0o755;
const PERMISOS_ARCHIVO = 0o644;

/**
 * Almacenamiento de las imágenes de producto de un negocio.
 *
 *     <UPLOADS_DIR>/negocios/{negocioId}/productos/
 *
 * El nombre lo genera el servidor y el `negocioId` viene del contexto
 * autorizado, nunca del cliente.
 */
@Injectable()
export class AlmacenamientoProductosService {
  private readonly logger = new Logger(AlmacenamientoProductosService.name);

  async guardar(
    negocioId: number,
    contenido: Buffer,
    extension: string,
  ): Promise<string> {
    const directorio = directorioProductosNegocio(negocioId);

    await this.asegurarDirectorio(directorio, negocioId);

    const nombre = this.generarNombre(extension);
    const destino = path.join(directorio, nombre);

    try {
      const temporal = `${destino}.tmp`;

      await fs.promises.writeFile(temporal, contenido, {
        mode: PERMISOS_ARCHIVO,
      });
      await fs.promises.rename(temporal, destino);
    } catch (error) {
      throw this.errorDeAlmacenamiento(
        'no se pudo guardar la imagen del producto',
        negocioId,
        error,
      );
    }

    return `${PREFIJO_PUBLICO_UPLOADS}/negocios/${negocioId}/productos/${nombre}`;
  }

  /** Borra solo referencias que están realmente dentro del negocio. */
  async eliminar(negocioId: number, referencia: string | null): Promise<void> {
    if (!referencia?.startsWith(`${PREFIJO_PUBLICO_UPLOADS}/`)) {
      return;
    }

    const relativa = referencia.slice(PREFIJO_PUBLICO_UPLOADS.length + 1);
    const absoluta = path.resolve(directorioUploads(), relativa);

    if (!estaDentroDeProductos(absoluta, negocioId)) {
      this.logger.warn(
        `Se ignora la eliminación de '${referencia}': no pertenece al espacio del negocio ${negocioId}.`,
      );
      return;
    }

    try {
      await fs.promises.unlink(absoluta);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.logger.warn(
          `No se pudo eliminar '${referencia}': ${(error as Error)?.message}`,
        );
      }
    }
  }

  private async asegurarDirectorio(
    directorio: string,
    negocioId: number,
  ): Promise<void> {
    try {
      await fs.promises.mkdir(directorio, {
        recursive: true,
        mode: PERMISOS_DIRECTORIO,
      });
      await fs.promises.access(directorio, fs.constants.W_OK);
    } catch (error) {
      throw this.errorDeAlmacenamiento(
        'el directorio de productos no está disponible o no se puede escribir',
        negocioId,
        error,
      );
    }
  }

  private errorDeAlmacenamiento(
    resumen: string,
    negocioId: number,
    causa: unknown,
  ): InternalServerErrorException {
    const codigo = (causa as NodeJS.ErrnoException)?.code ?? 'desconocido';

    this.logger.error(
      `Error de almacenamiento (${codigo}): ${resumen} en el espacio ` +
        `lógico 'negocios/${negocioId}/productos'.`,
      causa instanceof Error ? causa.stack : String(causa),
    );

    return new InternalServerErrorException(
      `No se pudo guardar el recurso: ${resumen}. ` +
        'Revisa el volumen de archivos (UPLOADS_DIR) del despliegue.',
    );
  }

  private generarNombre(extension: string): string {
    const marca = Date.now();
    const aleatorio = crypto.randomBytes(8).toString('hex');

    return `producto-${marca}-${aleatorio}.${extension}`;
  }
}

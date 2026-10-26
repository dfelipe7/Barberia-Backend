import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  directorioPerfilNegocio,
  directorioUploads,
  estaDentroDelPerfil,
  PREFIJO_PUBLICO_UPLOADS,
} from '../../../common/config/uploads.config';
import { DefinicionRecursoPerfil } from '../perfil-negocio.constants';

/**
 * Permisos del directorio de recursos: legible y ejecutable por el
 * propietario del proceso (lectura para los demás).
 */
const PERMISOS_DIRECTORIO = 0o755;

/** Permisos del archivo: legible por todos, escribible por el propietario. */
const PERMISOS_ARCHIVO = 0o644;

/**
 * Almacenamiento físico de los recursos de marca de un negocio (Fase 15).
 *
 * AISLAMIENTO
 * -----------
 * Cada negocio tiene su propio espacio:
 *
 *     <UPLOADS_DIR>/negocios/{negocioId}/perfil/
 *
 * El `negocioId` lo decide el SERVIDOR (procede del contexto autorizado) y
 * nunca el cliente. El nombre del fichero lo genera el servidor: el cliente
 * no puede elegir la ruta, la extensión ni el nombre.
 *
 * RUTAS PUBLICADAS
 * ----------------
 * Lo que se guarda en la base de datos es una ruta PÚBLICA relativa
 * (`/uploads/negocios/1/perfil/banner-1234-abcd.png`). Nunca se publica una
 * ruta absoluta del sistema de ficheros.
 *
 * PERSISTENCIA
 * ------------
 * El directorio cuelga de `UPLOADS_DIR`. En Docker debe ser un VOLUMEN
 * PERSISTENTE; en Railway, un volumen montado o un adaptador de objetos: el
 * sistema de ficheros del contenedor es efímero.
 *
 * ERRORES
 * -------
 * Si el almacenamiento no es utilizable (no existe, no se puede crear o no
 * se puede escribir), el error que se propaga es CLARO y NO incluye la ruta
 * absoluta del sistema de ficheros: solo la ubicación LÓGICA (`negocios/<id>`)
 * y la causa original.
 */
@Injectable()
export class AlmacenamientoPerfilService {
  private readonly logger = new Logger(AlmacenamientoPerfilService.name);

  /**
   * Escribe un recurso en el espacio del negocio y devuelve su ruta pública.
   *
   * El nombre se genera en el servidor: `<recurso>-<timestamp>-<aleatorio>.<ext>`.
   * Nunca se usa el nombre enviado por el cliente.
   */
  async guardar(
    negocioId: number,
    definicion: DefinicionRecursoPerfil,
    contenido: Buffer,
  ): Promise<string> {
    const directorio = directorioPerfilNegocio(negocioId);

    await this.asegurarDirectorio(directorio, negocioId);

    const nombre = this.generarNombre(definicion);
    const destino = path.join(directorio, nombre);

    try {
      // Se escribe en un fichero temporal y se renombra: el renombrado es
      // atómico en el mismo sistema de ficheros, de modo que nunca queda un
      // recurso a medio escribir en la ruta que se publica.
      const temporal = `${destino}.tmp`;

      await fs.promises.writeFile(temporal, contenido, {
        mode: PERMISOS_ARCHIVO,
      });
      await fs.promises.rename(temporal, destino);
    } catch (error) {
      throw this.errorDeAlmacenamiento(
        `no se pudo guardar el recurso '${definicion.etiqueta}'`,
        negocioId,
        error,
      );
    }

    return `${PREFIJO_PUBLICO_UPLOADS}/negocios/${negocioId}/perfil/${nombre}`;
  }

  /**
   * Elimina el archivo físico de una referencia, si existe.
   *
   * Solo se borra lo que está REALMENTE dentro del espacio del negocio: una
   * ruta externa (`https://...`) o una ruta de otro negocio se ignoran. Es la
   * barrera contra el borrado de recursos ajenos.
   */
  async eliminar(negocioId: number, referencia: string | null): Promise<void> {
    if (!referencia || !referencia.startsWith(`${PREFIJO_PUBLICO_UPLOADS}/`)) {
      return;
    }

    const relativa = referencia.slice(PREFIJO_PUBLICO_UPLOADS.length + 1);
    const absoluta = path.resolve(directorioUploads(), relativa);

    if (!estaDentroDelPerfil(absoluta, negocioId)) {
      this.logger.warn(
        `Se ignora la eliminación de '${referencia}': no pertenece al espacio del negocio ${negocioId}.`,
      );
      return;
    }

    try {
      await fs.promises.unlink(absoluta);
    } catch (error) {
      const codigo = (error as NodeJS.ErrnoException)?.code;

      if (codigo !== 'ENOENT') {
        this.logger.warn(
          `No se pudo eliminar el archivo '${referencia}': ${(error as Error)?.message}`,
        );
      }
    }
  }

  /**
   * Comprueba que el almacenamiento de un negocio es utilizable.
   *
   * Se ejecuta antes de cada escritura: si el volumen no está montado o no
   * se puede escribir, el error es claro desde el principio, no un fallo
   * difuso en mitad de la subida.
   */
  async asegurarDirectorio(
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
        'el directorio de recursos no está disponible o no se puede escribir',
        negocioId,
        error,
      );
    }
  }

  /**
   * Error de almacenamiento legible y SIN rutas absolutas del sistema de
   * ficheros (ni secretos).
   */
  private errorDeAlmacenamiento(
    resumen: string,
    negocioId: number,
    causa: unknown,
  ): InternalServerErrorException {
    const codigo = (causa as NodeJS.ErrnoException)?.code ?? 'desconocido';

    this.logger.error(
      `Error de almacenamiento (${codigo}): ${resumen} en el espacio ` +
        `logico 'negocios/${negocioId}'.`,
      causa instanceof Error ? causa.stack : String(causa),
    );

    return new InternalServerErrorException(
      `No se pudo guardar el recurso: ${resumen}. ` +
        'Revisa el volumen de archivos (UPLOADS_DIR) del despliegue.',
    );
  }

  /** Nombre interno del archivo, generado por el servidor. */
  private generarNombre(definicion: DefinicionRecursoPerfil): string {
    const marca = Date.now();
    const aleatorio = crypto.randomBytes(8).toString('hex');

    return `${definicion.recurso}-${marca}-${aleatorio}.${definicion.extension}`;
  }
}

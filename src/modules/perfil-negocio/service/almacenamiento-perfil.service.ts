import { Injectable, Logger } from '@nestjs/common';
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

    await fs.promises.mkdir(directorio, { recursive: true });

    const nombre = this.generarNombre(definicion);
    const destino = path.join(directorio, nombre);

    // Se escribe en un fichero temporal y se renombra: el renombrado es
    // atómico en el mismo sistema de ficheros, de modo que nunca queda un
    // recurso a medio escribir en la ruta que se publica.
    const temporal = `${destino}.tmp`;

    await fs.promises.writeFile(temporal, contenido);
    await fs.promises.rename(temporal, destino);

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

  /** Nombre interno del archivo, generado por el servidor. */
  private generarNombre(definicion: DefinicionRecursoPerfil): string {
    const marca = Date.now();
    const aleatorio = crypto.randomBytes(8).toString('hex');

    return `${definicion.recurso}-${marca}-${aleatorio}.${definicion.extension}`;
  }
}

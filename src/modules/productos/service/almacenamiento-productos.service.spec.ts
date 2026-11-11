import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AlmacenamientoProductosService } from './almacenamiento-productos.service';
import {
  directorioProductosNegocio,
  directorioUploads,
} from '../../../common/config/uploads.config';

describe('AlmacenamientoProductosService', () => {
  const servicio = new AlmacenamientoProductosService();
  let raiz: string;
  let anterior: string | undefined;

  beforeEach(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'productos-'));
    anterior = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = raiz;
  });

  afterEach(() => {
    fs.rmSync(raiz, { recursive: true, force: true });

    if (anterior === undefined) {
      delete process.env.UPLOADS_DIR;
    } else {
      process.env.UPLOADS_DIR = anterior;
    }
  });

  it('guarda en el espacio del negocio y devuelve una ruta pública', async () => {
    const referencia = await servicio.guardar(7, Buffer.from('imagen'), 'png');

    expect(referencia).toMatch(
      /^\/uploads\/negocios\/7\/productos\/producto-\d+-[a-f0-9]+\.png$/,
    );

    const absoluta = path.resolve(
      directorioUploads(),
      referencia.replace('/uploads/', ''),
    );
    expect(fs.existsSync(absoluta)).toBe(true);
    expect(path.dirname(absoluta)).toBe(directorioProductosNegocio(7));
  });

  it('elimina solo archivos del negocio indicado', async () => {
    const referencia = await servicio.guardar(7, Buffer.from('imagen'), 'png');
    const absoluta = path.resolve(
      directorioUploads(),
      referencia.replace('/uploads/', ''),
    );

    await servicio.eliminar(8, referencia);
    expect(fs.existsSync(absoluta)).toBe(true);

    await servicio.eliminar(7, referencia);
    expect(fs.existsSync(absoluta)).toBe(false);
  });
});

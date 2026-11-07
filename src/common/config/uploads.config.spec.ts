import * as path from 'node:path';
import {
  cabecerasSeguridadUploads,
  directorioNegocio,
  directorioPerfilNegocio,
  directorioProductosNegocio,
  directorioUploads,
  estaDentroDelPerfil,
  estaDentroDeProductos,
  resolverRutaPublicaUpload,
  UPLOADS_DIR_ENV,
} from './uploads.config';

describe('configuración de uploads', () => {
  const raiz = path.resolve('C:/app');

  it('usa <cwd>/uploads si no se define UPLOADS_DIR', () => {
    expect(directorioUploads({})).toBe(path.join(process.cwd(), 'uploads'));
  });

  it('respeta UPLOADS_DIR', () => {
    const entorno = { [UPLOADS_DIR_ENV]: '/datos/subidas' };

    expect(directorioUploads(entorno)).toBe(path.resolve('/datos/subidas'));
  });

  it('resuelve un UPLOADS_DIR relativo contra el directorio de trabajo', () => {
    const entorno = { [UPLOADS_DIR_ENV]: 'subidas' };

    expect(directorioUploads(entorno)).toBe(
      path.resolve(process.cwd(), 'subidas'),
    );
  });

  it('separa el espacio de cada negocio', () => {
    const entorno = { [UPLOADS_DIR_ENV]: '/datos/subidas' };

    expect(directorioNegocio(1, entorno)).toBe(
      path.join(path.resolve('/datos/subidas'), 'negocios', '1'),
    );
    expect(directorioPerfilNegocio(1, entorno)).toBe(
      path.join(path.resolve('/datos/subidas'), 'negocios', '1', 'perfil'),
    );
    expect(directorioPerfilNegocio(2, entorno)).not.toBe(
      directorioPerfilNegocio(1, entorno),
    );
  });

  it('acepta un archivo dentro del espacio del negocio', () => {
    const entorno = { [UPLOADS_DIR_ENV]: '/datos/subidas' };
    const dentro = path.join(
      directorioPerfilNegocio(1, entorno),
      'banner-1-abc.png',
    );

    expect(estaDentroDelPerfil(dentro, 1, entorno)).toBe(true);
  });

  it('RECHAZA el path traversal hacia otro negocio', () => {
    const entorno = { [UPLOADS_DIR_ENV]: '/datos/subidas' };
    const travesia = path.join(
      directorioPerfilNegocio(1, entorno),
      '..',
      '..',
      '2',
      'perfil',
      'banner-2-abc.png',
    );

    expect(estaDentroDelPerfil(travesia, 1, entorno)).toBe(false);
  });

  it('RECHAZA un archivo de la raíz de uploads', () => {
    const entorno = { [UPLOADS_DIR_ENV]: '/datos/subidas' };

    expect(
      estaDentroDelPerfil(
        path.join(path.resolve('/datos/subidas'), 'barberos', 'x.jpg'),
        1,
        entorno,
      ),
    ).toBe(false);
  });

  it('publica cabeceras de seguridad compatibles con SVG', () => {
    const cabeceras = cabecerasSeguridadUploads();

    expect(cabeceras['X-Content-Type-Options']).toBe('nosniff');
    expect(cabeceras['Content-Security-Policy']).toContain(
      "default-src 'none'",
    );
    expect(cabeceras['Content-Security-Policy']).toContain('sandbox');
  });

  it('usa una raíz de ejemplo válida', () => {
    expect(path.isAbsolute(raiz)).toBe(true);
  });

  it('separa las imágenes de producto del resto del negocio', () => {
    const entorno = { [UPLOADS_DIR_ENV]: '/datos/subidas' };
    const dentro = path.join(
      directorioProductosNegocio(1, entorno),
      'producto-1-abc.png',
    );

    expect(directorioProductosNegocio(1, entorno)).toBe(
      path.join(path.resolve('/datos/subidas'), 'negocios', '1', 'productos'),
    );
    expect(estaDentroDeProductos(dentro, 1, entorno)).toBe(true);
    expect(
      estaDentroDeProductos(
        path.join(directorioProductosNegocio(2, entorno), 'producto-2-abc.png'),
        1,
        entorno,
      ),
    ).toBe(false);
    describe('resolverRutaPublicaUpload', () => {
      it('resuelve la ruta relativa al negocio cuando destination apunta a una subcarpeta de negocio', () => {
        const root = directorioUploads();
        const mockArchivo = {
          filename: 'barbero-123.jpg',
          destination: path.join(root, 'negocios', '2', 'barberos'),
        } as any;

        const resultado = resolverRutaPublicaUpload(mockArchivo, 'barberos');
        expect(resultado).toBe('/uploads/negocios/2/barberos/barbero-123.jpg');
      });

      it('usa la carpeta de fallback si destination no esta definida', () => {
        const mockArchivo = {
          filename: 'servicio-456.jpg',
        } as any;

        const resultado = resolverRutaPublicaUpload(mockArchivo, 'servicios');
        expect(resultado).toBe('/uploads/servicios/servicio-456.jpg');
      });
    });
  });
});

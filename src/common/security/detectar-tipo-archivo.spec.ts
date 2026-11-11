import {
  detectarTipoArchivo,
  esJpeg,
  esPng,
  esSvg,
  esWebp,
  mimeDeTipoArchivo,
} from './detectar-tipo-archivo';

/** PNG mínimo válido: firma + IHDR. */
const PNG_VALIDO = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.from([0x00, 0x00, 0x00, 0x01]),
]);

describe('detectarTipoArchivo', () => {
  it('detecta un PNG por su firma binaria', () => {
    expect(esPng(PNG_VALIDO)).toBe(true);
    expect(detectarTipoArchivo(PNG_VALIDO)).toBe('png');
    expect(mimeDeTipoArchivo('png')).toBe('image/png');
  });

  it('detecta un JPEG por su firma binaria', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

    expect(esJpeg(jpeg)).toBe(true);
    expect(detectarTipoArchivo(jpeg)).toBe('jpeg');
    expect(mimeDeTipoArchivo('jpeg')).toBe('image/jpeg');
  });

  it('detecta un WEBP por su contenedor RIFF/WEBP', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x1a, 0x00, 0x00, 0x00]),
      Buffer.from('WEBPVP8 ', 'latin1'),
    ]);

    expect(esWebp(webp)).toBe(true);
    expect(detectarTipoArchivo(webp)).toBe('webp');
    expect(mimeDeTipoArchivo('webp')).toBe('image/webp');
  });

  it('rechaza un RIFF que no es WEBP y un JPEG truncado', () => {
    const riff = Buffer.from('RIFFxxxxWAVE', 'latin1');
    const jpegTruncado = Buffer.from([0xff, 0xd8]);

    expect(esWebp(riff)).toBe(false);
    expect(esJpeg(jpegTruncado)).toBe(false);
    expect(detectarTipoArchivo(riff)).toBe('desconocido');
    expect(detectarTipoArchivo(jpegTruncado)).toBe('desconocido');
  });

  it('detecta un SVG por su contenido', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
      'utf8',
    );

    expect(esSvg(svg)).toBe(true);
    expect(detectarTipoArchivo(svg)).toBe('svg');
    expect(mimeDeTipoArchivo('svg')).toBe('image/svg+xml');
  });

  it('NO se fia del nombre ni del Content-Type del cliente', () => {
    // Contenido HTML (que es lo que se suele subir para hacer XSS).
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');

    expect(detectarTipoArchivo(html)).toBe('desconocido');
    expect(esPng(html)).toBe(false);
    expect(esSvg(html)).toBe(false);
  });

  it('rechaza un PNG con la firma pero sin el chunk IHDR', () => {
    const tramposo = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('<html>no soy un png</html>', 'utf8'),
    ]);

    expect(detectarTipoArchivo(tramposo)).toBe('desconocido');
  });

  it('rechaza un SVG que en realidad es HTML con la etiqueta svg dentro', () => {
    const html = Buffer.from(
      '<html><body><svg>no es la raiz</svg></body></html>',
      'utf8',
    );

    expect(esSvg(html)).toBe(false);
  });

  it('acepta un SVG con declaración XML y BOM', () => {
    const svg = Buffer.from(
      '\uFEFF<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      'utf8',
    );

    expect(detectarTipoArchivo(svg)).toBe('svg');
  });

  it('devuelve un tipo MIME genérico para lo desconocido', () => {
    expect(mimeDeTipoArchivo('desconocido')).toBe('application/octet-stream');
  });
});

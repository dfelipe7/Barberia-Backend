import {
  detectarTipoArchivo,
  esPng,
  esSvg,
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

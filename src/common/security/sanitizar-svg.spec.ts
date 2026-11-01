import { BadRequestException } from '@nestjs/common';
import { sanitizarSvg } from './sanitizar-svg';

describe('sanitizarSvg', () => {
  const svgValido =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
    '<path d="M4 4h16v16H4z" fill="#0C0C0C"/>' +
    '<title>Logo</title>' +
    '</svg>';

  it('conserva un SVG válido', () => {
    const resultado = sanitizarSvg(svgValido);

    expect(resultado).toContain('<svg');
    expect(resultado).toContain('<path');
    expect(resultado).toContain('viewBox="0 0 24 24"');
    expect(resultado).toContain('fill="#0C0C0C"');
  });

  it('elimina los elementos script y su contenido', () => {
    const malicioso =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect x="1"/></svg>';

    // Un SVG con script se RECHAZA: no se almacena "limpiado" en silencio.
    expect(() => sanitizarSvg(malicioso)).toThrow(BadRequestException);
  });

  it('elimina los manejadores de evento', () => {
    const malicioso =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" onload="alert(1)" onclick="alert(2)"/></svg>';

    expect(() => sanitizarSvg(malicioso)).toThrow(BadRequestException);
  });

  it('elimina las referencias externas y conserva las locales', () => {
    const conReferenciaExterna =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<use xlink:href="https://malicioso.example/x.svg#a"/>' +
      '<use xlink:href="#local"/>' +
      '</svg>';

    // Una referencia externa se elimina (no se rechaza el archivo): el
    // documento sigue siendo un logo válido.
    const resultado = sanitizarSvg(conReferenciaExterna);

    expect(resultado).not.toContain('malicioso.example');
    expect(resultado).toContain('href="#local"');
  });

  it('elimina los estilos con url() o javascript:', () => {
    const conUrl =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://malicioso.example/x)"/></svg>';

    const resultado = sanitizarSvg(conUrl);

    expect(resultado).not.toContain('malicioso.example');
  });

  it('rechaza los marcos y el contenido embebido', () => {
    expect(() =>
      sanitizarSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body>x</body></foreignObject></svg>',
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      sanitizarSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="https://malicioso.example"></iframe></svg>',
      ),
    ).toThrow(BadRequestException);
  });

  it('rechaza las declaraciones DOCTYPE y ENTITY', () => {
    const conDoctype =
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
      '<svg xmlns="http://www.w3.org/2000/svg">&xxe;</svg>';

    expect(() => sanitizarSvg(conDoctype)).toThrow(BadRequestException);
  });

  it('rechaza un documento que no es un SVG', () => {
    expect(() => sanitizarSvg('<html><body>hola</body></html>')).toThrow(
      BadRequestException,
    );
  });

  it('elimina los comentarios y las instrucciones de proceso', () => {
    const conComentarios =
      '<?xml version="1.0"?><?xml-stylesheet href="https://malicioso.example/x.css"?>' +
      '<!-- comentario --><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

    const resultado = sanitizarSvg(conComentarios);

    expect(resultado).not.toContain('malicioso.example');
    expect(resultado).not.toContain('comentario');
    expect(resultado).toContain('<svg');
  });

  it('conserva los elementos de dibujo habituales', () => {
    const resultado = sanitizarSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><g><circle cx="1" cy="2" r="3"/>' +
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<text x="1" y="2">Hola</text></g></svg>',
    );

    expect(resultado).toContain('<circle');
    expect(resultado).toContain('<linearGradient');
    expect(resultado).toContain('<text');
  });
  it('conserva el auto-cierre /> en etiquetas como path o circle', () => {
    const conAutoCierre =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<path d="M4 4h16v16H4z" fill="#0C0C0C" />' +
      '<circle cx="12" cy="12" r="5" />' +
      '</svg>';

    const resultado = sanitizarSvg(conAutoCierre);
    expect(resultado).toContain('<path d="M4 4h16v16H4z" fill="#0C0C0C" />');
    expect(resultado).toContain('<circle cx="12" cy="12" r="5" />');
    expect(resultado).not.toContain('>>');
  });
});

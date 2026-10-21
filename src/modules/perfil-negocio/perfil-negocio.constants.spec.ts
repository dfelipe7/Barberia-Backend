import { derivarUrlMapa, PLANTILLA_URL_MAPA } from './perfil-negocio.constants';

describe('Perfil de negocio: derivación de la URL del mapa', () => {
  it('deriva la URL canónica a partir de las coordenadas', () => {
    const url = derivarUrlMapa(2.4839891, -76.5807622);

    expect(url).toBe(`${PLANTILLA_URL_MAPA}2.4839891,-76.5807622`);
    expect(url).toContain('2.4839891');
    expect(url).toContain('-76.5807622');
  });

  it('devuelve null si no hay coordenadas', () => {
    expect(derivarUrlMapa(null, null)).toBeNull();
    expect(derivarUrlMapa(2.4839891, null)).toBeNull();
    expect(derivarUrlMapa(null, -76.5807622)).toBeNull();
  });

  it('no requiere API key: es un enlace de busqueda, no la Embed API', () => {
    const url = derivarUrlMapa(0, 0);

    expect(url).not.toContain('key=');
    expect(url).not.toContain('/embed');
  });
});

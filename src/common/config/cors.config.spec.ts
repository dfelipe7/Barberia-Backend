import {
  CABECERAS_ADMITIDAS,
  construirOpcionesCors,
  construirOrigenesPermitidos,
} from './cors.config';

describe('Configuración CORS', () => {
  describe('cabeceras admitidas', () => {
    it('admite las cabeceras de los flujos de negocio y de reservas de invitado', () => {
      expect(CABECERAS_ADMITIDAS).toEqual([
        'Content-Type',
        'Authorization',
        'X-Negocio-Slug',
        'X-Reservation-Management-Token',
      ]);
    });

    it('las incluye en las opciones CORS', () => {
      const opciones = construirOpcionesCors(['http://localhost:5173']);

      expect(opciones.allowedHeaders).toContain('X-Negocio-Slug');
      expect(opciones.allowedHeaders).toContain(
        'X-Reservation-Management-Token',
      );
      expect(opciones.allowedHeaders).toContain('Authorization');
      expect(opciones.allowedHeaders).toContain('Content-Type');
    });

    it('admite el método OPTIONS (preflight)', () => {
      const opciones = construirOpcionesCors(['http://localhost:5173']);

      expect(opciones.methods).toContain('OPTIONS');
    });
  });

  describe('orígenes permitidos', () => {
    it('nunca usa un comodín: la API sirve con credenciales', () => {
      const opciones = construirOpcionesCors();

      expect(opciones.origin).not.toContain('*');
      expect(opciones.credentials).toBe(true);
    });

    it('añade el origen declarado en FRONTEND_URL', () => {
      const origenes = construirOrigenesPermitidos({
        FRONTEND_URL: 'https://frontend.example.com/',
      });

      expect(origenes).toContain('https://frontend.example.com');
    });

    it('ignora FRONTEND_URL vacío', () => {
      const origenes = construirOrigenesPermitidos({ FRONTEND_URL: '  ' });

      expect(origenes).toEqual([
        'http://localhost:5173',
        'http://localhost:3000',
        'https://barberia-frontend-production.up.railway.app',
      ]);
    });
  });
});

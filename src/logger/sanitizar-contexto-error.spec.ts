/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: fijar el comportamiento de saneamiento de ruta y de construcción del contexto seguro.
 * - Responsabilidad: pruebas unitarias del saneador. No exercise el filtro ni el correo.
 */
import {
  VALOR_REDACTADO,
  construirContextoSeguro,
  redactarParametro,
  redactarSegmento,
  sanearRuta,
} from './sanitizar-contexto-error';

describe('sanearRuta', () => {
  it('conserva la ruta cuando no hay nada que redactar', () => {
    expect(sanearRuta('/reservas/me/42')).toBe('/reservas/me/42');
  });

  it('conserva la query string y redacta solo los valores sensibles', () => {
    expect(sanearRuta('/auth/google?clave=abc&fecha=2026-10-21')).toBe(
      '/auth/google?clave=[redactado]&fecha=2026-10-21',
    );
  });

  it('redacta el valor de un parámetro sensible y conserva su nombre', () => {
    expect(sanearRuta('/auth/google?token=abc123')).toBe(
      `/auth/google?token=${VALOR_REDACTADO}`,
    );
    expect(sanearRuta('/auth/google?codigo=123456')).toBe(
      `/auth/google?codigo=${VALOR_REDACTADO}`,
    );
  });

  it('redacta un valor con forma de credencial aunque el nombre sea inocuo', () => {
    const credencial =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.unaFirmaMuyLargaDePrueba';
    expect(sanearRuta(`/auth/verify?dato=${credencial}`)).toBe(
      `/auth/verify?dato=${VALOR_REDACTADO}`,
    );
  });

  it('conserva los parámetros que no son sensibles', () => {
    expect(sanearRuta('/reservas/admin?fecha=2026-10-21&servicioId=3')).toBe(
      '/reservas/admin?fecha=2026-10-21&servicioId=3',
    );
  });

  it('redacta un segmento de ruta con forma de token', () => {
    expect(
      sanearRuta('/invitado/eyJhbGciOiJIUzI1NiIsUnaFirmaLargaDePrueba'),
    ).toBe(`/invitado/${VALOR_REDACTADO}`);
  });

  it('no redacta identificadores numéricos', () => {
    expect(sanearRuta('/reservas/admin/123456789012')).toBe(
      '/reservas/admin/123456789012',
    );
  });

  it('no rompe con una url vacía o ausente', () => {
    expect(sanearRuta('')).toBe('');
    expect(sanearRuta(undefined)).toBe('');
  });
});

describe('redactarSegmento', () => {
  it('deja intactos los segmentos cortos', () => {
    expect(redactarSegmento('reservas')).toBe('reservas');
  });
});

describe('redactarParametro', () => {
  it('deja intactos los parámetros sin valor', () => {
    expect(redactarParametro('solo')).toBe('solo');
  });
});

describe('construirContextoSeguro', () => {
  const peticion = {
    url: '/auth/google?token=abc',
    method: 'POST',
    ip: '127.0.0.1',
    user: { email: 'persona@ejemplo.com', sub: 'kc-1' },
  };

  it('conserva el contexto operativo y NO incluye el cuerpo de la petición', () => {
    const cuerpo = {
      idToken: 'SECRETO-DE-PRUEBA-GOOGLE',
      password: 'SECRETO-DE-PRUEBA-CLAVE',
    };

    const contexto = construirContextoSeguro(
      { ...peticion, body: cuerpo } as never,
      {
        status: 403,
        message: 'Prohibido',
        codigoError: 'SLOT_TAKEN',
        requestId: 'req-1',
      },
    );

    expect(contexto.status).toBe(403);
    expect(contexto.method).toBe('POST');
    expect(contexto.path).toBe('/auth/google?token=[redactado]');
    expect(contexto.requestId).toBe('req-1');
    expect(contexto.codigoError).toBe('SLOT_TAKEN');
    expect(contexto.ip).toBe('127.0.0.1');
    expect(contexto.user).toBe('persona@ejemplo.com');

    const serializado = JSON.stringify(contexto);
    expect(serializado).not.toContain('SECRETO-DE-PRUEBA-GOOGLE');
    expect(serializado).not.toContain('SECRETO-DE-PRUEBA-CLAVE');
    expect(contexto).not.toHaveProperty('body');
  });

  it('omite el código de error cuando la excepción no lo aporta', () => {
    const contexto = construirContextoSeguro(peticion, {
      status: 500,
      message: 'Error',
      requestId: 'req-2',
    });

    expect(contexto).not.toHaveProperty('codigoError');
  });

  it('omite el usuario cuando la petición no está autenticada', () => {
    const contexto = construirContextoSeguro(
      { url: '/x', method: 'GET' },
      { status: 401, message: 'No autorizado', requestId: 'req-3' },
    );

    expect(contexto).not.toHaveProperty('user');
    expect(contexto).not.toHaveProperty('ip');
  });
});

/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: fijar la regla de habilitación del simulador de error 500.
 * - Responsabilidad: pruebas unitarias de la configuración. No exercise rutas HTTP.
 */
import {
  SIMULADOR_ERROR_HABILITADO_ENV,
  simuladorErrorHabilitado,
} from './simulador-error.config';

describe('simuladorErrorHabilitado', () => {
  it('no se habilita por defecto (sin habilitación explícita)', () => {
    expect(simuladorErrorHabilitado({})).toBe(false);
  });

  it('se habilita fuera de producción con habilitación explícita', () => {
    expect(
      simuladorErrorHabilitado({
        NODE_ENV: 'development',
        [SIMULADOR_ERROR_HABILITADO_ENV]: 'true',
      }),
    ).toBe(true);
  });

  it('acepta el valor con espacios y mayúsculas', () => {
    expect(
      simuladorErrorHabilitado({ [SIMULADOR_ERROR_HABILITADO_ENV]: ' TRUE ' }),
    ).toBe(true);
  });

  it('NUNCA se habilita en producción, ni siquiera con habilitación explícita', () => {
    expect(
      simuladorErrorHabilitado({
        NODE_ENV: 'production',
        [SIMULADOR_ERROR_HABILITADO_ENV]: 'true',
      }),
    ).toBe(false);
  });

  it('tampoco se habilita en producción si la variable está ausente', () => {
    expect(simuladorErrorHabilitado({ NODE_ENV: 'production' })).toBe(false);
  });

  it('tampoco se habilita si el entorno de producción está en otra caja', () => {
    expect(
      simuladorErrorHabilitado({
        NODE_ENV: 'PRODUCTION',
        [SIMULADOR_ERROR_HABILITADO_ENV]: 'true',
      }),
    ).toBe(false);
  });

  it('no se habilita con valores distintos de "true"', () => {
    for (const valor of ['1', 'yes', 'si', 'false', '']) {
      expect(
        simuladorErrorHabilitado({
          NODE_ENV: 'development',
          [SIMULADOR_ERROR_HABILITADO_ENV]: valor,
        }),
      ).toBe(false);
    }
  });
});

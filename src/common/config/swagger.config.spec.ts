import { swaggerHabilitado } from './swagger.config';

describe('Disponibilidad de Swagger', () => {
  it('se publica en desarrollo', () => {
    expect(swaggerHabilitado({ NODE_ENV: 'development' })).toBe(true);
  });

  it('se publica cuando no se declara NODE_ENV', () => {
    expect(swaggerHabilitado({})).toBe(true);
  });

  it('NO se publica en producción por defecto', () => {
    expect(swaggerHabilitado({ NODE_ENV: 'production' })).toBe(false);
  });

  it('se puede habilitar explícitamente en producción', () => {
    expect(
      swaggerHabilitado({ NODE_ENV: 'production', SWAGGER_HABILITADO: 'true' }),
    ).toBe(true);
  });

  it('se puede deshabilitar explícitamente en desarrollo', () => {
    expect(
      swaggerHabilitado({
        NODE_ENV: 'development',
        SWAGGER_HABILITADO: 'false',
      }),
    ).toBe(false);
  });
});

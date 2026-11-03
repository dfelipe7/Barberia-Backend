import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActualizarRedSocialDto } from './actualizar-red-social.dto';

/**
 * Valida un DTO con las MISMAS reglas que aplica el `ValidationPipe` global
 * de la aplicación (`whitelist` y `forbidNonWhitelisted`).
 */
async function validar(
  datos: Record<string, unknown>,
): Promise<string[]> {
  const instancia = plainToInstance(ActualizarRedSocialDto, datos);

  const errores = await validate(instancia, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errores.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('ActualizarRedSocialDto', () => {
  it('acepta un objeto vacío (el servicio lo rechaza, no el DTO)', async () => {
    // La validación de "al menos un campo" la hace el servicio.
    const errores = await validar({});
    expect(errores).toEqual([]);
  });

  it('acepta solo url', async () => {
    const errores = await validar({ url: 'https://nuevo.com' });
    expect(errores).toEqual([]);
  });

  it('acepta solo nombre', async () => {
    const errores = await validar({ nombre: 'Mi canal' });
    expect(errores).toEqual([]);
  });

  it('acepta solo orden', async () => {
    const errores = await validar({ orden: 3 });
    expect(errores).toEqual([]);
  });

  it('acepta los tres campos juntos', async () => {
    const errores = await validar({
      url: 'https://tiktok.com/@kyrios',
      nombre: 'Mi canal',
      orden: 1,
    });
    expect(errores).toEqual([]);
  });

  it('rechaza una URL sin protocolo HTTPS', async () => {
    const errores = await validar({ url: 'http://inseguro.com' });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza una URL inválida', async () => {
    const errores = await validar({ url: 'no-es-una-url' });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza nombre vacío', async () => {
    const errores = await validar({ nombre: '' });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza nombre que supera 80 caracteres', async () => {
    const errores = await validar({ nombre: 'a'.repeat(81) });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza orden negativo', async () => {
    const errores = await validar({ orden: -1 });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza orden decimal', async () => {
    const errores = await validar({ orden: 1.5 });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza campos desconocidos', async () => {
    const errores = await validar({ tipo: 'INSTAGRAM' });
    expect(errores.length).toBeGreaterThan(0);
  });
});


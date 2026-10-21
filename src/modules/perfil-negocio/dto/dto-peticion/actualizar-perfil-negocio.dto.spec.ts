import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ActualizarPerfilNegocioDto,
  ActualizarReferenciasPerfilDto,
} from './actualizar-perfil-negocio.dto';

/**
 * Valida un DTO con las MISMAS reglas que aplica el `ValidationPipe` global
 * de la aplicación (`whitelist` y `forbidNonWhitelisted`).
 *
 * @returns Los mensajes de error de validación (vacío si el DTO es válido).
 */
async function validar(
  dtoClass: new () => object,
  datos: Record<string, unknown>,
): Promise<string[]> {
  const instancia = plainToInstance(dtoClass, datos);

  const errores = await validate(instancia, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errores.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('ActualizarPerfilNegocioDto', () => {
  it('acepta un perfil completo con coordenadas válidas', async () => {
    const errores = await validar(ActualizarPerfilNegocioDto, {
      frasePrincipal: 'Barbería de alto estándar',
      direccion: 'Vía al Bosque, Tv 9A Norte',
      ciudad: 'Popayán',
      departamento: 'Cauca',
      referencia: 'Local 2',
      latitud: 2.4839891,
      longitud: -76.5807622,
    });

    expect(errores).toEqual([]);
  });

  it('acepta un perfil incompleto sin coordenadas', async () => {
    const errores = await validar(ActualizarPerfilNegocioDto, {
      frasePrincipal: 'Solo la frase',
    });

    expect(errores).toEqual([]);
  });

  it('acepta coordenadas en los extremos del rango', async () => {
    const errores = await validar(ActualizarPerfilNegocioDto, {
      latitud: -90,
      longitud: 180,
    });

    expect(errores).toEqual([]);
  });

  it('rechaza una latitud fuera de rango', async () => {
    const errores = await validar(ActualizarPerfilNegocioDto, {
      latitud: 91,
      longitud: -76.5807622,
    });

    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza una longitud fuera de rango', async () => {
    const errores = await validar(ActualizarPerfilNegocioDto, {
      latitud: 2.4839891,
      longitud: -181,
    });

    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza coordenadas no numéricas', async () => {
    const errores = await validar(ActualizarPerfilNegocioDto, {
      latitud: 'abc',
      longitud: -76.5807622,
    });

    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza coordenadas parciales (solo latitud)', async () => {
    const errores = await validar(ActualizarPerfilNegocioDto, {
      latitud: 2.4839891,
    });

    expect(errores.length).toBeGreaterThan(0);
    expect(errores.join(' ')).toContain('juntas');
  });

  it('rechaza coordenadas parciales (solo longitud)', async () => {
    const errores = await validar(ActualizarPerfilNegocioDto, {
      longitud: -76.5807622,
    });

    expect(errores.length).toBeGreaterThan(0);
    expect(errores.join(' ')).toContain('juntas');
  });

  it('rechaza textos que superan el limite de longitud', async () => {
    const errores = await validar(ActualizarPerfilNegocioDto, {
      frasePrincipal: 'a'.repeat(201),
      direccion: 'b'.repeat(201),
      ciudad: 'c'.repeat(121),
      departamento: 'd'.repeat(121),
      referencia: 'e'.repeat(201),
    });

    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza un negocioId enviado por el cliente', async () => {
    const errores = await validar(ActualizarPerfilNegocioDto, {
      frasePrincipal: 'Intento',
      negocioId: 2,
    });

    expect(errores.length).toBeGreaterThan(0);
  });
});

describe('ActualizarReferenciasPerfilDto', () => {
  it('acepta rutas relativas y URLs http/https', async () => {
    const errores = await validar(ActualizarReferenciasPerfilDto, {
      faviconUrl: '/uploads/negocios/a/favicon.png',
      bannerUrl: 'https://cdn.example.com/banner.png',
      logoBlancoUrl: '/uploads/negocios/a/logo-blanco.png',
      logoNegroUrl: '/uploads/negocios/a/logo-negro.png',
    });

    expect(errores).toEqual([]);
  });

  it('rechaza esquemas ejecutables', async () => {
    const errores = await validar(ActualizarReferenciasPerfilDto, {
      bannerUrl: 'javascript:alert(1)',
    });

    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza una referencia demasiado larga', async () => {
    const errores = await validar(ActualizarReferenciasPerfilDto, {
      bannerUrl: `/${'a'.repeat(500)}`,
    });

    expect(errores.length).toBeGreaterThan(0);
  });
});

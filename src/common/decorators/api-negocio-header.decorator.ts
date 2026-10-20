import { ApiHeader } from '@nestjs/swagger';

/**
 * Documenta la cabecera que selecciona la barbería de la petición.
 *
 * El subdominio es el mecanismo PRINCIPAL de resolución del negocio. Esta
 * cabecera es la ALTERNATIVA admitida para clientes móviles, emuladores y
 * entornos sin subdominio (`X-Negocio-Slug`).
 *
 * No transporta credenciales: únicamente selecciona el negocio, y la
 * autorización se resuelve aparte contra la pertenencia de la persona a ese
 * negocio. Un negocio inexistente o inactivo se rechaza con 404.
 *
 * Se declara como opcional porque, cuando el subdominio está configurado, la
 * cabecera no es necesaria.
 */
export const ApiNegocioHeader = () =>
  ApiHeader({
    name: 'X-Negocio-Slug',
    required: false,
    description:
      'Slug público de la barbería (alternativa al subdominio). Ejemplo: kyrios-studio. Si el subdominio no está configurado, esta cabecera es OBLIGATORIA en las rutas de negocio.',
  });

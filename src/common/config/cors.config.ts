import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Configuración CORS de la API.
 *
 * Se separa de `main.ts` para poder PROBARLA: `main.ts` es un arranque de
 * proceso y no es importable desde las pruebas.
 */

/**
 * Cabeceras que el navegador puede enviar en las peticiones a la API.
 *
 * - `Content-Type` y `Authorization`: contrato habitual de la API.
 * - `X-Negocio-Slug`: selecciona la barbería de la petición (alternativa
 *   admitida al subdominio). No transporta credenciales.
 * - `X-Reservation-Management-Token`: token de gestión de la reserva de
 *   INVITADO. Es el ÚNICO canal autorizado para esa credencial: sin él, el
 *   preflight (OPTIONS) del navegador bloquea la petición y el flujo de
 *   reservas de invitado no funciona.
 */
export const CABECERAS_ADMITIDAS = [
  'Content-Type',
  'Authorization',
  'X-Negocio-Slug',
  'X-Reservation-Management-Token',
] as const;

/** Métodos HTTP admitidos por la API. */
export const METODOS_ADMITIDOS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

/**
 * Orígenes permitidos por defecto (desarrollo y despliegue conocido).
 *
 * NO se usa `*`: la API sirve con `credentials: true`, y un comodín es
 * incompatible con las credenciales. Los orígenes de producción se añaden
 * con `FRONTEND_URL`.
 */
export const ORIGENES_POR_DEFECTO = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://barberia-frontend-production.up.railway.app',
] as const;

/**
 * Construye la lista de orígenes permitidos a partir del entorno.
 *
 * `FRONTEND_URL` permite declarar el origen real del frontend. No se
 * interpretan dominios comodín ni se confían cabeceras `Host`/`X-Forwarded-*`
 * de proxies: los orígenes se declaran de forma explícita.
 */
export function construirOrigenesPermitidos(
  entorno: Record<string, string | undefined> = process.env,
): string[] {
  const origenes: string[] = [...ORIGENES_POR_DEFECTO];

  const frontendUrl = entorno.FRONTEND_URL?.trim();

  if (frontendUrl) {
    origenes.push(frontendUrl.replace(/\/$/, ''));
  }

  return origenes;
}

/**
 * Opciones CORS de la API.
 *
 * `origin` es una LISTA explícita (nunca `*`): la API se consume con
 * credenciales y el acceso se restringe a los orígenes declarados.
 */
export function construirOpcionesCors(
  origenes: string[] = construirOrigenesPermitidos(),
): CorsOptions {
  return {
    origin: origenes,
    methods: [...METODOS_ADMITIDOS],
    allowedHeaders: [...CABECERAS_ADMITIDAS],
    credentials: true,
  };
}

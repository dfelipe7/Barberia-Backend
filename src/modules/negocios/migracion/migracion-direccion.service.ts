/**
 * Lógica de la MIGRACIÓN CONTROLADA de la dirección comercial (Fase 16).
 *
 * Contexto: `PerfilNegocio.direccion` pasa a ser la fuente canónica de la
 * dirección comercial. La clave heredada `negocio_direccion` de
 * `ConfiguracionNegocio` sigue existiendo (y la consume WhatsApp como
 * respaldo temporal), pero sus valores heredados deben pasar al perfil sin
 * perder ni sobrescribir nada.
 *
 * Se separa de Prisma para poder PROBARLA SIN BASE DE DATOS: las funciones
 * son puras (no tocan la base de datos), reciben el estado necesario y
 * devuelven la decisión. El script `prisma/multitenant/migrar-direccion.ts`
 * las aplica sobre Prisma real.
 */

/** Clave heredada de la que se migra la dirección. */
export const CLAVE_DIRECCION_HEREDADA = 'negocio_direccion';

/** Estado de un negocio frente a la migración de su dirección. */
export interface EstadoDireccionNegocio {
  /** Slug público del negocio. */
  slug: string;
  /** Nombre público del negocio. */
  nombre: string;
  /** Estado del negocio (`ACTIVO` / `INACTIVO`). */
  estado: string;
  /** Dirección ya configurada en el PERFIL del negocio, si la hay. */
  direccionPerfil: string | null;
  /** Valor heredado en `ConfiguracionNegocio`, si existe. */
  direccionHeredada: string | null;
  /** `true` si el negocio tiene ya fila de perfil. */
  tienePerfil: boolean;
}

/**
 * Decisión sobre la dirección de un negocio.
 *
 * - `transferir`: el valor heredado es válido y el perfil no tiene
 *   dirección. Se copia SOLO el campo `direccion`.
 * - `conservar`: el perfil ya tiene dirección. NUNCA se sobrescribe.
 * - `omitir`: no hay nada que transferir.
 */
export type DecisionDireccion =
  | { accion: 'transferir'; direccion: string; motivo: string }
  | { accion: 'conservar'; motivo: string }
  | { accion: 'omitir'; motivo: string };

/**
 * Indica si un texto sirve como dirección comercial.
 *
 * Un valor vacío (o solo con puntuación) NO es una dirección: puede ser el
 * valor por defecto de la siembra, no una decisión del propietario. Por eso
 * no se interpreta como "dirección vacía intentionada" y simplemente no hay
 * nada que transferir.
 */
export function esDireccionValida(valor: string | null | undefined): boolean {
  if (valor === null || valor === undefined) {
    return false;
  }

  return /[\p{L}\p{N}]/u.test(valor.trim());
}

/**
 * Decide qué hacer con la dirección de un negocio.
 *
 * REGLAS (en este orden):
 *  1. Si el PERFIL ya tiene dirección, se CONSERVA: la fuente canónica gana
 *     siempre y el valor heredado nunca sobrescribe una dirección ya
 *     configurada.
 *  2. Si el valor heredado no es una dirección válida, se OMITE: no hay
 *     nada que transferir y no se inventa nada.
 *  3. En otro caso, se TRANSFIERE el valor heredado.
 */
export function decidirTransferenciaDireccion(
  estado: EstadoDireccionNegocio,
): DecisionDireccion {
  if (esDireccionValida(estado.direccionPerfil)) {
    return {
      accion: 'conservar',
      motivo:
        'El perfil ya tiene dirección configurada: se conserva y no se ' +
        'sobrescribe con el valor heredado.',
    };
  }

  if (!esDireccionValida(estado.direccionHeredada)) {
    return {
      accion: 'omitir',
      motivo:
        'No hay un valor heredado que transferir. Un valor vacío puede ser el ' +
        'valor por defecto de la siembra, no una decisión del propietario: no ' +
        'se inventa ninguna dirección.',
    };
  }

  return {
    accion: 'transferir',
    direccion: (estado.direccionHeredada ?? '').trim(),
    motivo: estado.tienePerfil
      ? 'El perfil existe pero no tiene dirección: se copia solo el campo ' +
        'direccion, sin tocar el resto.'
      : 'El negocio no tiene perfil: se crea con la dirección heredada y el ' +
        'resto de campos a null.',
  };
}

/**
 * Indica si un negocio sigue dependiendo del respaldo heredado.
 *
 * Es la EVIDENCIA que hay que tener antes de retirar la clave
 * `negocio_direccion`: si algún negocio devuelve `true`, todavía la usa.
 */
export function dependeDelRespaldoHeredado(
  estado: EstadoDireccionNegocio,
): boolean {
  return (
    !esDireccionValida(estado.direccionPerfil) &&
    esDireccionValida(estado.direccionHeredada)
  );
}

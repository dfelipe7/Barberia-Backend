/**
 * Modelos que pertenecen a un negocio (tenant) y los que NO.
 *
 * La clasificación es la fuente de verdad para:
 *  - los filtros explícitos de los repositorios,
 *  - la extensión de Prisma que actúa como defensa adicional.
 *
 * IMPORTANTE: los nombres son los de los DELEGATES de Prisma, que siguen
 * el nombre del MODELO en PascalCase (`Cliente`, `Barbero`, `Reservation`...),
 * verificado empíricamente contra Prisma 7.10.1. No son los nombres de
 * tabla, que usan `@@map` y una convención distinta.
 */
export const MODELOS_TENANT_SCOPED = [
  'Administrador',
  'Barbero',
  'BarberoServicio',
  'BarberScheduleBlock',
  'BarberWeeklySlot',
  'Cliente',
  'ConfiguracionNegocio',
  'GeneralClosure',
  'PerfilNegocio',
  'Reservation',
  'Servicio',
] as const;

export type ModeloTenantScoped = (typeof MODELOS_TENANT_SCOPED)[number];

/**
 * Modelos globales: NO se filtran por negocio.
 *
 * - `Usuario`: identidad de la persona en la plataforma. Sus perfiles
 *   operativos (`Administrador`, `Barbero`) sí son tenant-scoped.
 * - `Negocio`: el propio tenant.
 * - `ConfiguracionSistema`: parámetros de plataforma.
 * - `WhatsAppPlantilla`: plantillas de HU-11, genéricas y sin datos de
 *   negocio.
 */
export const MODELOS_GLOBALES = [
  'Usuario',
  'Negocio',
  'ConfiguracionSistema',
  'WhatsAppPlantilla',
] as const;

export type ModeloGlobal = (typeof MODELOS_GLOBALES)[number];

/** `true` si el modelo pertenece a un negocio y debe filtrarse. */
export function esModeloTenantScoped(
  modelo: string,
): modelo is ModeloTenantScoped {
  return (MODELOS_TENANT_SCOPED as readonly string[]).includes(modelo);
}

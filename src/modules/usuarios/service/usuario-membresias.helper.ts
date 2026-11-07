/**
 * Utilidad compartida para evaluar membresías activas de un usuario en otras sedes (multitenant).
 */
export function tieneMembresiasActivasEnOtrasSedes(
  usuario: {
    administradores?: Array<{ negocioId: number; estado: string }>;
    barberos?: Array<{ negocioId: number; estado: string }>;
  },
  negocioIdActual: number,
): boolean {
  const tieneAdminExterno = (usuario.administradores ?? []).some(
    (a) => a.negocioId !== negocioIdActual && a.estado === 'ACTIVO',
  );
  if (tieneAdminExterno) {
    return true;
  }

  return (usuario.barberos ?? []).some(
    (b) => b.negocioId !== negocioIdActual && b.estado === 'ACTIVO',
  );
}


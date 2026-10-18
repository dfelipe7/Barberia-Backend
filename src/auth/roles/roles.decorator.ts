import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Decorador @Roles()
 *
 * Este decorador personalizado permite etiquetar cualquier ruta (endpoint) del controlador
 * con los roles que están autorizados para acceder a ella.
 * Ejemplo: @Roles('SUPERADMIN', 'ADMINISTRADOR')
 *
 * Por debajo, guarda estos strings en los metadatos de NestJS para que luego
 * el RolesGuard pueda leerlos y decidir si deja pasar al usuario o no.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

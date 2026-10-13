import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Servicio de Comunicación con Keycloak
 * 
 * Permite integración opcional con Keycloak si KEYCLOAK_URL está configurado.
 * Si KEYCLOAK_URL no está presente (por ejemplo, en despliegues con Google OAuth + JWT),
 * el servicio opera en modo desacoplado / seguro sin lanzar errores de red ni bloquear operaciones locales.
 */
@Injectable()
export class KeycloakService {
  private readonly logger = new Logger(KeycloakService.name);

  constructor(
    private readonly configService: ConfigService,
  ) {}

  /**
   * Obtiene la configuración base de Keycloak desde las variables de entorno.
   */
  private obtenerConfiguracion() {
    return {
      url: this.configService.get<string>('KEYCLOAK_URL', ''),
      realm: this.configService.get<string>('KEYCLOAK_REALM', 'barberia'),
      clientId: this.configService.get<string>(
        'KEYCLOAK_CLIENT_ID',
        'barberia-backend',
      ),
      clientSecret: this.configService.get<string>(
        'KEYCLOAK_CLIENT_SECRET',
        '',
      ),
    };
  }

  /**
   * Indica si Keycloak está configurado y habilitado en las variables de entorno.
   */
  isConfigured(): boolean {
    const { url } = this.obtenerConfiguracion();
    return Boolean(url && url.trim().length > 0 && url !== 'disabled');
  }

  /**
   * Autenticación "Backend a Backend".
   * Pide un Token especial de administrador (Client Credentials Grant) a Keycloak.
   */
  async obtenerTokenAdministrativo(): Promise<string> {
    if (!this.isConfigured()) {
      return '';
    }

    const {
      url,
      realm,
      clientId,
      clientSecret,
    } = this.obtenerConfiguracion();

    try {
      const response = await axios.post(
        `${url}/realms/${realm}/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 3000,
        },
      );

      return response.data.access_token;
    } catch (error: any) {
      this.logger.warn(`No se pudo obtener token administrativo de Keycloak: ${error?.message}`);
      return '';
    }
  }

  /**
   * Crea un nuevo usuario directamente en la base de datos de Keycloak.
   */
  async crearUsuario(
    email: string,
    password: string,
    nombre: string,
    apellido?: string,
  ): Promise<string> {
    if (!this.isConfigured()) {
      return 'local-' + Date.now();
    }

    const {
      url,
      realm,
    } = this.obtenerConfiguracion();

    const token = await this.obtenerTokenAdministrativo();
    if (!token) {
      return 'local-' + Date.now();
    }

    try {
      const response = await axios.post(
        `${url}/admin/realms/${realm}/users`,
        {
          username: email,
          email,
          firstName: nombre,
          lastName: apellido,
          enabled: true,
          emailVerified: false,
          credentials: [
            {
              type: 'password',
              value: password,
              temporary: true,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 3000,
        },
      );

      const location = response.headers.location;
      if (!location) {
        return 'local-' + Date.now();
      }

      return location.split('/').pop()!;
    } catch (error: any) {
      if (error.response?.status === 409) {
        throw new ConflictException(`Ya existe un usuario con el correo: ${email}`);
      }
      this.logger.warn(`Error al crear usuario en Keycloak: ${error?.message}`);
      return 'local-' + Date.now();
    }
  }

  /**
   * Le asigna un Rol de nivel de Reino a un usuario específico en Keycloak.
   */
  async asignarRol(
    keycloakUserId: string,
    roleName: string,
  ): Promise<void> {
    if (!this.isConfigured()) return;

    const { url, realm } = this.obtenerConfiguracion();
    const token = await this.obtenerTokenAdministrativo();
    if (!token) return;

    try {
      const roleResponse = await axios.get(
        `${url}/admin/realms/${realm}/roles/${roleName}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 3000,
        },
      );

      await axios.post(
        `${url}/admin/realms/${realm}/users/${keycloakUserId}/role-mappings/realm`,
        [roleResponse.data],
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 3000,
        },
      );
    } catch (error: any) {
      this.logger.warn(`Error asignando rol ${roleName} en Keycloak: ${error?.message}`);
    }
  }

  /**
   * Le quita un Rol específico a un usuario en Keycloak.
   */
  async quitarRol(
    keycloakUserId: string,
    roleName: string,
  ): Promise<void> {
    if (!this.isConfigured()) return;

    const { url, realm } = this.obtenerConfiguracion();
    const token = await this.obtenerTokenAdministrativo();
    if (!token) return;

    try {
      const roleResponse = await axios.get(
        `${url}/admin/realms/${realm}/roles/${roleName}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 3000,
        },
      );

      await axios.delete(
        `${url}/admin/realms/${realm}/users/${keycloakUserId}/role-mappings/realm`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: [roleResponse.data],
          timeout: 3000,
        },
      );
    } catch (error: any) {
      this.logger.warn(`Error quitando rol ${roleName} en Keycloak: ${error?.message}`);
    }
  }

  /**
   * Busca en Keycloak a todos los usuarios que tengan un rol específico.
   */
  async obtenerUsuariosPorRol(
    roleName: string,
  ): Promise<any[]> {
    if (!this.isConfigured()) return [];

    const { url, realm } = this.obtenerConfiguracion();
    const token = await this.obtenerTokenAdministrativo();
    if (!token) return [];

    try {
      const response = await axios.get(
        `${url}/admin/realms/${realm}/roles/${roleName}/users`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 3000,
        },
      );

      return response.data;
    } catch (error: any) {
      this.logger.warn(`Error obteniendo usuarios con rol ${roleName} en Keycloak: ${error?.message}`);
      return [];
    }
  }

  /**
   * Actualiza el perfil de un usuario en Keycloak.
   */
  async actualizarUsuario(
    keycloakUserId: string,
    data: {
      email?: string;
      nombre?: string;
      apellido?: string;
    },
  ): Promise<void> {
    if (!this.isConfigured()) return;

    const { url, realm } = this.obtenerConfiguracion();
    const token = await this.obtenerTokenAdministrativo();
    if (!token) return;

    try {
      await axios.put(
        `${url}/admin/realms/${realm}/users/${keycloakUserId}`,
        {
          ...(data.email !== undefined && {
            email: data.email,
            username: data.email,
          }),
          ...(data.nombre !== undefined && {
            firstName: data.nombre,
          }),
          ...(data.apellido !== undefined && {
            lastName: data.apellido,
          }),
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 3000,
        },
      );
    } catch (error: any) {
      this.logger.warn(`Error actualizando usuario en Keycloak: ${error?.message}`);
    }
  }

  /**
   * Cambia el estado global de una cuenta en Keycloak.
   */
  async cambiarEstadoUsuario(
    keycloakUserId: string,
    activo: boolean,
  ): Promise<void> {
    if (!this.isConfigured()) return;

    const { url, realm } = this.obtenerConfiguracion();
    const token = await this.obtenerTokenAdministrativo();
    if (!token) return;

    try {
      await axios.put(
        `${url}/admin/realms/${realm}/users/${keycloakUserId}`,
        {
          enabled: activo,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 3000,
        },
      );
    } catch (error: any) {
      this.logger.warn(`Error cambiando estado en Keycloak: ${error?.message}`);
    }
  }

  /**
   * Verifica la contraseña de un usuario en Keycloak.
   */
  async verificarContrasena(email: string, contrasena: string): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const { url, realm, clientId, clientSecret } = this.obtenerConfiguracion();
    try {
      await axios.post(
        `${url}/realms/${realm}/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'password',
          client_id: clientId,
          client_secret: clientSecret,
          username: email,
          password: contrasena,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 3000,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cambia la contraseña de un usuario en Keycloak.
   */
  async cambiarContrasena(keycloakUserId: string, nuevaContrasena: string): Promise<void> {
    if (!this.isConfigured()) return;

    const { url, realm } = this.obtenerConfiguracion();
    const token = await this.obtenerTokenAdministrativo();
    if (!token) return;

    try {
      await axios.put(
        `${url}/admin/realms/${realm}/users/${keycloakUserId}/reset-password`,
        {
          type: 'password',
          value: nuevaContrasena,
          temporary: false,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 3000,
        },
      );
    } catch (error: any) {
      this.logger.warn(`Error cambiando contraseña en Keycloak: ${error?.message}`);
    }
  }

  /**
   * Elimina un usuario de Keycloak.
   */
  async eliminarUsuario(keycloakUserId: string) {
    if (!this.isConfigured()) return;

    const token = await this.obtenerTokenAdministrativo();
    if (!token) return;

    const { url, realm } = this.obtenerConfiguracion();

    try {
      await axios.delete(
        `${url}/admin/realms/${realm}/users/${keycloakUserId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 3000,
        },
      );
    } catch (error: any) {
      this.logger.warn(`Error eliminando usuario de Keycloak: ${error?.message}`);
    }
  }
}
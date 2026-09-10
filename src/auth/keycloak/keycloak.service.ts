import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Servicio de Comunicación con Keycloak
 * 
 * A diferencia del Guard (que solo lee tokens de clientes), este servicio
 * se encarga de hablar de "Backend a Backend" con el servidor de Keycloak
 * usando las credenciales secretas (KEYCLOAK_CLIENT_SECRET).
 * 
 * Funciona como un administrador robot: puede crear usuarios, asignarles roles,
 * buscar usuarios y suspenderlos directamente en la base de datos de Keycloak.
 */
@Injectable()
export class KeycloakService {
  constructor(
    private readonly configService: ConfigService,
  ) {}

  /**
   * Obtiene la configuración base de Keycloak desde las variables de entorno.
   * Centraliza la lectura del archivo .env para no repetir código.
   */
  private obtenerConfiguracion() {
    return {
      url: this.configService.getOrThrow<string>('KEYCLOAK_URL'),
      realm: this.configService.getOrThrow<string>('KEYCLOAK_REALM'),
      clientId: this.configService.getOrThrow<string>(
        'KEYCLOAK_CLIENT_ID',
      ),
      clientSecret: this.configService.getOrThrow<string>(
        'KEYCLOAK_CLIENT_SECRET',
      ),
    };
  }

  /**
   * Autenticación "Backend a Backend".
   * Pide un Token especial de administrador (Client Credentials Grant) a Keycloak.
   * Con este token, nuestro servidor tiene permisos para crear usuarios o asignar roles.
   */
  async obtenerTokenAdministrativo(): Promise<string> {
    const {
      url,
      realm,
      clientId,
      clientSecret,
    } = this.obtenerConfiguracion();

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
      },
    );

    return response.data.access_token;
  }


  /**
   * Crea un nuevo usuario directamente en la base de datos de Keycloak.
   * Le asigna una contraseña inicial.
   * @returns El ID único universal (UUID) que Keycloak le asignó al usuario recién creado.
   */
  async crearUsuario(
    email: string,
    password: string,
    nombre: string,
    apellido?: string,
  ): Promise<string> {
    const {
      url,
      realm,
    } = this.obtenerConfiguracion();

  const token =
    await this.obtenerTokenAdministrativo();

  const response = await axios
    .post(
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
      },
    )
    .catch((error) => {
      if (error.response?.status === 409) {
        throw new ConflictException(
          `Ya existe un usuario con el correo: ${email}`,
        );
      }
      throw error;
    });

  const location =
    response.headers.location;

  if (!location) {
    throw new Error(
      'Keycloak no devolvió el identificador del usuario',
    );
  }

  return location.split('/').pop()!;
}

  /**
   * Le asigna un Rol de nivel de Reino (Realm Role) a un usuario específico en Keycloak.
   * Ejemplo: Asignar el rol 'BARBERO' al usuario 'abcd-1234'.
   */
  async asignarRol(
    keycloakUserId: string,
    roleName: string,
  ): Promise<void> {
    const {
      url,
      realm,
    } = this.obtenerConfiguracion();

  const token =
    await this.obtenerTokenAdministrativo();

  const roleResponse = await axios.get(
    `${url}/admin/realms/${realm}/roles/${roleName}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
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
      },
    );
  }

  /**
   * Le quita (revoca) un Rol específico a un usuario en Keycloak.
   * Útil cuando se suspende a un barbero pero no se quiere borrar su cuenta completa.
   */
  async quitarRol(
    keycloakUserId: string,
    roleName: string,
  ): Promise<void> {
    const { url, realm } = this.obtenerConfiguracion();
    const token = await this.obtenerTokenAdministrativo();

    const roleResponse = await axios.get(
      `${url}/admin/realms/${realm}/roles/${roleName}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
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
      },
    );
  }


  /**
   * Busca en Keycloak a todos los usuarios que tengan un rol específico.
   * Usado principalmente por el BootstrapService para encontrar al SUPERADMIN al arrancar el servidor.
   */
  async obtenerUsuariosPorRol(
    roleName: string,
  ): Promise<any[]> {
    const {
      url,
      realm,
    } = this.obtenerConfiguracion();

  const token =
    await this.obtenerTokenAdministrativo();

  const response = await axios.get(
    `${url}/admin/realms/${realm}/roles/${roleName}/users`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return response.data;
}

  /**
   * Actualiza el perfil de un usuario (Email, Nombre, Apellido) en Keycloak.
   * Mantiene sincronizados los datos personales entre nuestro MySQL y Keycloak.
   */
  async actualizarUsuario(
    keycloakUserId: string,
    data: {
      email?: string;
      nombre?: string;
      apellido?: string;
    },
  ): Promise<void> {
    const {
      url,
      realm,
    } = this.obtenerConfiguracion();

  const token =
    await this.obtenerTokenAdministrativo();

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
    },
  );
}

  /**
   * Cambia el estado global de una cuenta en Keycloak (Enabled = true/false).
   * Si se pone en false, el usuario no podrá iniciar sesión en lo absoluto, sin importar sus roles.
   */
  async cambiarEstadoUsuario(
    keycloakUserId: string,
    activo: boolean,
  ): Promise<void> {
    const {
      url,
      realm,
    } = this.obtenerConfiguracion();

  const token =
    await this.obtenerTokenAdministrativo();

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
    },
  );
}

  /**
   * Verifica la contraseña actual de un usuario intentando un login real en Keycloak.
   * Usa el flujo "Resource Owner Password Credentials Grant".
   */
  async verificarContrasena(email: string, contrasena: string): Promise<boolean> {
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
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cambia la contraseña de un usuario en Keycloak usando el token administrativo.
   */
  async cambiarContrasena(keycloakUserId: string, nuevaContrasena: string): Promise<void> {
    const { url, realm } = this.obtenerConfiguracion();
    const token = await this.obtenerTokenAdministrativo();

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
      },
    );
  }
}
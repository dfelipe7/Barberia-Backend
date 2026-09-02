import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class KeycloakService {
  constructor(
    private readonly configService: ConfigService,
  ) {}

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
            temporary: false,
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
}
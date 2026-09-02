import {
  ConflictException,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';

import { KeycloakService } from '../../../auth/keycloak/keycloak.service';

import { CrearAdministradorDto } from '../dto/crear-administrador.dto';
import { CrearBarberoDto } from '../dto/crear-barbero.dto';
import { ConfigurarBarberoDto } from '../dto/configurar-barbero.dto';
import { ActualizarUsuarioDto } from '../dto/actualizar-usuario.dto';
import { CambiarEstadoUsuarioDto } from '../dto/cambiar-estado-usuario.dto';
import { ActualizarComisionDto } from '../dto/actualizar-comision.dto';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberoCatalogoDto } from '../dto/barbero-catalogo.dto';

@Injectable()
export class UsuariosService {
  constructor(
    private readonly usuariosRepository: UsuariosRepository,
    private readonly keycloakService: KeycloakService,
  ) {}

  async crearAdministrador(
    dto: CrearAdministradorDto,
  ) {
    const keycloakId =
      await this.keycloakService.crearUsuario(
        dto.email,
        dto.password,
        dto.nombre,
        dto.apellido,
      );

    await this.keycloakService.asignarRol(
      keycloakId,
      'ADMINISTRADOR',
    );

    try {
      const usuario =
        await this.usuariosRepository.crearUsuario({
          keycloakId,
          email: dto.email,
          nombre: dto.nombre,
          apellido: dto.apellido ?? '',
          rol: 'ADMINISTRADOR',
        });

      const administrador =
        await this.usuariosRepository.crearAdministrador({
          usuarioId: usuario.id,
        });

      return {
        mensaje: 'Administrador creado correctamente',
        administrador,
      };
    } catch (error) {
      console.error(
        'Error guardando administrador en la base de datos:',
        error,
      );

      throw new ConflictException(
        'El administrador no pudo registrarse en la base de datos',
      );
    }
  }

  async crearBarbero(
    dto: CrearBarberoDto,
  ) {
    const keycloakId =
      await this.keycloakService.crearUsuario(
        dto.email,
        dto.password,
        dto.nombre,
        dto.apellido,
      );

    await this.keycloakService.asignarRol(
      keycloakId,
      'BARBERO',
    );

    try {
      const usuario =
        await this.usuariosRepository.crearUsuario({
          keycloakId,
          email: dto.email,
          nombre: dto.nombre,
          apellido: dto.apellido,
          rol: 'BARBERO',
        });

      const barbero =
        await this.usuariosRepository.crearBarberoNuevo({
          usuarioId: usuario.id,
          telefono: dto.telefono,
          porcentajeComision: dto.porcentajeComision,
        });

      return {
        mensaje: 'Barbero creado correctamente',
        barbero,
      };
    } catch (error) {
      console.error(
        'Error guardando barbero en la base de datos:',
        error,
      );

      throw new ConflictException(
        'El barbero no pudo registrarse en la base de datos',
      );
    }
  }

async configurarBarbero(
  keycloakId: string,
  dto: ConfigurarBarberoDto,
) {
  const usuario =
    await this.usuariosRepository.obtenerUsuarioPorKeycloakId(
      keycloakId,
    );

  if (!usuario) {
    throw new ConflictException(
      'El usuario no existe',
    );
  }

  if (usuario.barbero) {
    throw new ConflictException(
      'El usuario ya está configurado como barbero',
    );
  }

  return this.usuariosRepository.crearPerfilBarbero({
    usuarioId: usuario.id,
    telefono: dto.telefono,
    porcentajeComision: dto.porcentajeComision,
  });
}

async configurarBarberoPorId(
  usuarioId: number,
  dto: ConfigurarBarberoDto,
) {
  const usuario =
    await this.usuariosRepository.obtenerUsuarioPorId(
      usuarioId,
    );

  if (!usuario) {
    throw new ConflictException(
      'El usuario no existe',
    );
  }

  if (usuario.barbero) {
    throw new ConflictException(
      'El usuario ya está configurado como barbero',
    );
  }

  if (!usuario.administrador) {
    throw new ConflictException(
      'El usuario no es un administrador',
    );
  }

  return this.usuariosRepository.crearPerfilBarbero({
    usuarioId: usuario.id,
    telefono: dto.telefono,
    porcentajeComision: dto.porcentajeComision,
  });
}

async sincronizarSuperadmin() {
  const superadmins =
    await this.keycloakService.obtenerUsuariosPorRol(
      'SUPERADMIN',
    );

  if (superadmins.length === 0) {
    throw new ConflictException(
      'No existe ningún SUPERADMIN en Keycloak',
    );
  }

  if (superadmins.length > 1) {
    throw new ConflictException(
      'Existe más de un SUPERADMIN en Keycloak',
    );
  }

  const superadmin = superadmins[0];

  const usuarioExistente =
    await this.usuariosRepository.obtenerUsuarioPorKeycloakId(
      superadmin.id,
    );

  if (usuarioExistente) {
    return {
      mensaje: 'El SUPERADMIN ya existe en la base de datos',
      usuario: usuarioExistente,
    };
  }

  const usuario =
    await this.usuariosRepository.crearUsuario({
      keycloakId: superadmin.id,
      email: superadmin.email,
      nombre: superadmin.firstName ?? '',
      apellido: superadmin.lastName ?? '',
      rol: 'SUPERADMIN',
    });

  return {
    mensaje: 'SUPERADMIN sincronizado correctamente',
    usuario,
  };
}

async obtenerUsuarioPorId(
  usuarioId: number,
  usuarioAutenticado: any,
) {
  const usuario =
    await this.usuariosRepository.obtenerUsuarioPorId(
      usuarioId,
    );

  if (!usuario) {
    throw new ConflictException(
      'El usuario no existe',
    );
  }

  const usuarioActual =
    await this.usuariosRepository.obtenerUsuarioPorKeycloakId(
      usuarioAutenticado.sub,
    );

  if (!usuarioActual) {
    throw new ConflictException(
      'El usuario autenticado no existe en la base de datos',
    );
  }

  if (usuarioActual.rol === 'SUPERADMIN') {
    return usuario;
  }

  if (usuarioActual.rol === 'ADMINISTRADOR') {
    const esSuPropioPerfil =
      usuarioActual.id === usuario.id;

    const esBarbero =
      usuario.barbero !== null;

    if (esSuPropioPerfil || esBarbero) {
      return usuario;
    }

    throw new ForbiddenException(
      'No tienes permisos para consultar este usuario',
    );
  }

  if (usuarioActual.rol === 'BARBERO') {
    const esSuPropioPerfil =
      usuarioActual.id === usuario.id;

    if (esSuPropioPerfil) {
      return usuario;
    }

    throw new ForbiddenException(
      'Solo puedes consultar tu propio perfil',
    );
  }

  throw new ForbiddenException(
    'No tienes permisos para consultar este usuario',
  );
}
async actualizarUsuario(
  usuarioId: number,
  dto: ActualizarUsuarioDto,
  usuarioAutenticado: any,
) {
  const usuario =
    await this.usuariosRepository.obtenerUsuarioPorId(
      usuarioId,
    );

  if (!usuario) {
    throw new ConflictException(
      'El usuario no existe',
    );
  }

  const usuarioActual =
    await this.usuariosRepository.obtenerUsuarioPorKeycloakId(
      usuarioAutenticado.sub,
    );

  if (!usuarioActual) {
    throw new ConflictException(
      'El usuario autenticado no existe en la base de datos',
    );
  }

  if (usuarioActual.rol === 'SUPERADMIN') {
    await this.keycloakService.actualizarUsuario(
      usuario.keycloakId,
      {
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
      },
    );

    return this.usuariosRepository.actualizarUsuario(
      usuarioId,
      {
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
      },
    );
  }

  if (usuarioActual.rol === 'ADMINISTRADOR') {
    const esSuPropioPerfil =
      usuarioActual.id === usuario.id;

    const esBarbero =
      usuario.barbero !== null;

    if (!esSuPropioPerfil && !esBarbero) {
      throw new ForbiddenException(
        'No tienes permisos para editar este usuario',
      );
    }

    await this.keycloakService.actualizarUsuario(
      usuario.keycloakId,
      {
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
      },
    );

    return this.usuariosRepository.actualizarUsuario(
      usuarioId,
      {
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
      },
    );
  }

  if (usuarioActual.rol === 'BARBERO') {
    const esSuPropioPerfil =
      usuarioActual.id === usuario.id;

    if (!esSuPropioPerfil) {
      throw new ForbiddenException(
        'Solo puedes editar tu propio perfil',
      );
    }

    await this.keycloakService.actualizarUsuario(
      usuario.keycloakId,
      {
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
      },
    );

    return this.usuariosRepository.actualizarUsuario(
      usuarioId,
      {
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
      },
    );
  }

  throw new ForbiddenException(
    'No tienes permisos para editar este usuario',
  );
}

async cambiarEstadoUsuario(
  usuarioId: number,
  dto: CambiarEstadoUsuarioDto,
  usuarioAutenticado: any,
) {
  const usuario =
    await this.usuariosRepository.obtenerUsuarioPorId(
      usuarioId,
    );

  if (!usuario) {
    throw new ConflictException(
      'El usuario no existe',
    );
  }

  const usuarioActual =
    await this.usuariosRepository.obtenerUsuarioPorKeycloakId(
      usuarioAutenticado.sub,
    );

  if (!usuarioActual) {
    throw new ConflictException(
      'El usuario autenticado no existe en la base de datos',
    );
  }

  if (usuarioActual.id === usuario.id) {
    throw new ForbiddenException(
      'No puedes cambiar el estado de tu propio usuario',
    );
  }

  if (usuarioActual.rol === 'SUPERADMIN') {
    // Puede gestionar cualquier usuario excepto a sí mismo.
  } else if (usuarioActual.rol === 'ADMINISTRADOR') {
    const esBarbero =
      usuario.barbero !== null;

    if (!esBarbero) {
      throw new ForbiddenException(
        'Solo puedes cambiar el estado de los barberos',
      );
    }
  } else {
    throw new ForbiddenException(
      'No tienes permisos para cambiar el estado de este usuario',
    );
  }

  const nuevoEstado = dto.estado;

  const activo =
    nuevoEstado === EstadoUsuario.ACTIVO;

  await this.keycloakService.cambiarEstadoUsuario(
    usuario.keycloakId,
    activo,
  );

  return this.usuariosRepository.actualizarEstadoUsuario(
    usuarioId,
    nuevoEstado,
  );
}

async actualizarComision(
  usuarioId: number,
  dto: ActualizarComisionDto,
  usuarioAutenticado: any,
) {
  const usuario =
    await this.usuariosRepository.obtenerUsuarioPorId(
      usuarioId,
    );

  if (!usuario) {
    throw new ConflictException(
      'El usuario no existe',
    );
  }

  if (!usuario.barbero) {
    throw new ConflictException(
      'El usuario no es un barbero',
    );
  }

  const usuarioActual =
    await this.usuariosRepository.obtenerUsuarioPorKeycloakId(
      usuarioAutenticado.sub,
    );

  if (!usuarioActual) {
    throw new ConflictException(
      'El usuario autenticado no existe en la base de datos',
    );
  }

  if (
    usuarioActual.rol !== 'SUPERADMIN' &&
    usuarioActual.rol !== 'ADMINISTRADOR'
  ) {
    throw new ForbiddenException(
      'No tienes permisos para modificar la comisión',
    );
  }

  return this.usuariosRepository.actualizarComision(
    usuarioId,
    dto.porcentajeComision,
  );
}

async obtenerBarberosCatalogo(): Promise<BarberoCatalogoDto[]> {
  const barberos =
    await this.usuariosRepository.obtenerBarberosCatalogo();

  return barberos.map((barbero) => ({
    id: barbero.id,
    nombre: barbero.usuario.nombre,
    apellido: barbero.usuario.apellido,
    telefono: barbero.telefono,
  }));
}


async obtenerAdministradores() {
  const administradores =
    await this.usuariosRepository.obtenerAdministradores();

  return administradores.map(
    (administrador) => ({
      id: administrador.usuario.id,
      nombre: administrador.usuario.nombre,
      apellido: administrador.usuario.apellido,
      email: administrador.usuario.email,
      estado: administrador.usuario.estado,
    }),
  );
}

async obtenerBarberosGestion() {
  const barberos =
    await this.usuariosRepository.obtenerBarberosGestion();

  return barberos.map((barbero) => ({
    id: barbero.usuario.id,
    nombre: barbero.usuario.nombre,
    apellido: barbero.usuario.apellido,
    email: barbero.usuario.email,
    telefono: barbero.telefono,
    porcentajeComision:
      Number(barbero.porcentajeComision),
    estado: barbero.estado,
  }));
}


}
import { Injectable, ConflictException } from '@nestjs/common';
import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberosRepository } from '../repository/barberos.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { CrearBarberoDto } from '../dto/crear-barbero.dto';
import { ConfigurarBarberoDto } from '../dto/configurar-barbero.dto';
import { ActualizarComisionDto } from '../dto/actualizar-comision.dto';
import { BarberoCatalogoDto } from '../dto/barbero-catalogo.dto';
import { CambiarEstadoUsuarioDto } from '../dto/cambiar-estado-usuario.dto';
import { EstadoUsuario } from '../../../../generated/prisma/enums';

@Injectable()
export class BarberosService {
  constructor(
    private readonly barberosRepository: BarberosRepository,
    private readonly usuariosRepository: UsuariosRepository,
    private readonly keycloakService: KeycloakService,
    private readonly authorizationService: UsuariosAuthorizationService,
  ) {}

  async crearBarbero(dto: CrearBarberoDto) {
    const usuarioExistente = await this.usuariosRepository.obtenerUsuarioPorEmail(dto.email);
    if (usuarioExistente) {
      throw new ConflictException('Ya existe un usuario en el sistema con este correo electrónico.');
    }
    const keycloakId = await this.keycloakService.crearUsuario(
      dto.email,
      dto.password,
      dto.nombre,
      dto.apellido,
    );

    await this.keycloakService.asignarRol(keycloakId, 'BARBERO');

    try {
      const usuario = await this.usuariosRepository.crearUsuario({
        keycloakId,
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
        rol: 'BARBERO',
      });

      const barbero = await this.barberosRepository.crearBarberoNuevo({
        usuarioId: usuario.id,
        telefono: dto.telefono,
        porcentajeComision: dto.porcentajeComision,
      });

      return {
        mensaje: 'Barbero creado correctamente',
        barbero,
      };
    } catch (error) {
      console.error('Error guardando barbero en la base de datos:', error);
      throw new ConflictException('El barbero no pudo registrarse en la base de datos');
    }
  }

  async configurarBarbero(keycloakId: string, dto: ConfigurarBarberoDto) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(keycloakId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (usuario.barbero) {
      throw new ConflictException('El usuario ya está configurado como barbero');
    }

    return this.barberosRepository.crearPerfilBarbero({
      usuarioId: usuario.id,
      telefono: dto.telefono,
      porcentajeComision: dto.porcentajeComision,
    });
  }

  async configurarBarberoPorId(usuarioId: number, dto: ConfigurarBarberoDto) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (usuario.barbero) {
      throw new ConflictException('El usuario ya está configurado como barbero');
    }

    if (!usuario.administrador) {
      throw new ConflictException('El usuario no es un administrador');
    }

    return this.barberosRepository.crearPerfilBarbero({
      usuarioId: usuario.id,
      telefono: dto.telefono,
      porcentajeComision: dto.porcentajeComision,
    });
  }

  async actualizarComision(usuarioId: number, dto: ActualizarComisionDto, usuarioAutenticado: any) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (!usuario.barbero) {
      throw new ConflictException('El usuario no es un barbero');
    }

    const usuarioActual = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(usuarioAutenticado.sub);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosComision(usuarioActual);

    return this.barberosRepository.actualizarComision(usuarioId, dto.porcentajeComision);
  }

  async obtenerBarberosCatalogo(): Promise<BarberoCatalogoDto[]> {
    const barberos = await this.barberosRepository.obtenerBarberosCatalogo();

    return barberos.map((barbero) => ({
      id: barbero.id,
      nombre: barbero.usuario.nombre,
      apellido: barbero.usuario.apellido,
      telefono: barbero.telefono,
    }));
  }

  async obtenerBarberosGestion() {
    const barberos = await this.barberosRepository.obtenerBarberosGestion();

    return barberos.map((barbero) => ({
      id: barbero.usuario.id,
      nombre: barbero.usuario.nombre,
      apellido: barbero.usuario.apellido,
      email: barbero.usuario.email,
      telefono: barbero.telefono,
      porcentajeComision: Number(barbero.porcentajeComision),
      estado: barbero.estado,
    }));
  }

  async cambiarEstadoBarbero(usuarioId: number, dto: CambiarEstadoUsuarioDto, usuarioAutenticado: any) {
    const usuario = await this.usuariosRepository.obtenerUsuarioPorId(usuarioId);

    if (!usuario) {
      throw new ConflictException('El usuario no existe');
    }

    if (!usuario.barbero) {
      throw new ConflictException('El usuario no es un barbero');
    }

    const usuarioActual = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(usuarioAutenticado.sub);

    if (!usuarioActual) {
      throw new ConflictException('El usuario autenticado no existe en la base de datos');
    }

    this.authorizationService.verificarPermisosCambioEstado(usuarioActual, usuario);

    const nuevoEstado = dto.estado;
    const activo = nuevoEstado === EstadoUsuario.ACTIVO;

    if (activo) {
      await this.keycloakService.asignarRol(usuario.keycloakId, 'BARBERO');
    } else {
      await this.keycloakService.quitarRol(usuario.keycloakId, 'BARBERO');
    }

    return this.barberosRepository.actualizarEstadoBarbero(usuarioId, nuevoEstado);
  }
}

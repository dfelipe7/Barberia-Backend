import { Injectable, ConflictException } from '@nestjs/common';
import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { AdministradoresRepository } from '../repository/administradores.repository';
import { CrearAdministradorDto } from '../dto/crear-administrador.dto';

@Injectable()
export class AdministradoresService {
  constructor(
    private readonly administradoresRepository: AdministradoresRepository,
    private readonly usuariosRepository: UsuariosRepository,
    private readonly keycloakService: KeycloakService,
  ) {}

  async crearAdministrador(dto: CrearAdministradorDto) {
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

    await this.keycloakService.asignarRol(keycloakId, 'ADMINISTRADOR');

    try {
      const usuario = await this.usuariosRepository.crearUsuario({
        keycloakId,
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido ?? '',
        rol: 'ADMINISTRADOR',
      });

      const administrador = await this.administradoresRepository.crearAdministrador({
        usuarioId: usuario.id,
      });

      return {
        mensaje: 'Administrador creado correctamente',
        administrador,
      };
    } catch (error) {
      console.error('Error guardando administrador en la base de datos:', error);
      throw new ConflictException('El administrador no pudo registrarse en la base de datos');
    }
  }

  async obtenerAdministradores() {
    const administradores = await this.administradoresRepository.obtenerAdministradores();

    return administradores.map((administrador) => ({
      id: administrador.usuario.id,
      nombre: administrador.usuario.nombre,
      apellido: administrador.usuario.apellido,
      email: administrador.usuario.email,
      estado: administrador.usuario.estado,
    }));
  }
}

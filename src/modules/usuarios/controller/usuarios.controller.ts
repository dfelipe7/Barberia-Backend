import {
  Body,
  Controller,
  Post,
  Get,
  Req,
  Patch,
  UseGuards,
  Param,
} from '@nestjs/common';

import { Roles } from '../../../auth/roles/roles.decorator';
import { KeycloakAuthGuard } from '../../../auth/keycloak-auth/keycloak-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

import { CrearAdministradorDto } from '../dto/crear-administrador.dto';
import { UsuariosService } from '../service/usuarios.service';
import { CrearBarberoDto } from '../dto/crear-barbero.dto';
import { ConfigurarBarberoDto } from '../dto/configurar-barbero.dto';
import { ActualizarUsuarioDto } from '../dto/actualizar-usuario.dto';
import { CambiarEstadoUsuarioDto } from '../dto/cambiar-estado-usuario.dto';
import { ActualizarComisionDto } from '../dto/actualizar-comision.dto';

@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuariosService: UsuariosService,
  ) {}

  @Post('administradores')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  async crearAdministrador(
    @Body() dto: CrearAdministradorDto,
  ) {
    return this.usuariosService.crearAdministrador(dto);
  }

  @Post('barberos')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  async crearBarbero(
    @Body() dto: CrearBarberoDto,
  ) {
    return this.usuariosService.crearBarbero(dto);
  }

  @Post('me/barbero')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  async configurarMiPerfilComoBarbero(
    @Req() request: any,
    @Body() dto: ConfigurarBarberoDto,
  ) {
    const keycloakId = request.user.sub;

    return this.usuariosService.configurarBarbero(
      keycloakId,
      dto,
    );
  }

  @Post('sincronizar-superadmin')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  async sincronizarSuperadmin() {
    return this.usuariosService.sincronizarSuperadmin();
  }

  @Post(':id/barbero')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  async configurarBarberoPorId(
    @Param('id') id: string,
    @Body() dto: ConfigurarBarberoDto,
  ) {
    return this.usuariosService.configurarBarberoPorId(
      Number(id),
      dto,
    );
  }


@Get('administradores')
@UseGuards(KeycloakAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
async obtenerAdministradores() {
  return this.usuariosService.obtenerAdministradores();
}

@Get('barberos/gestion')
@UseGuards(KeycloakAuthGuard, RolesGuard)
@Roles('SUPERADMIN', 'ADMINISTRADOR')
async obtenerBarberosGestion() {
  return this.usuariosService.obtenerBarberosGestion();
}



  @Get('barberos')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  async obtenerBarberosCatalogo() {
    return this.usuariosService.obtenerBarberosCatalogo();
  }

  @Get(':id')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  async obtenerUsuarioPorId(
    @Param('id') id: string,
    @Req() request: any,
  ) {
    return this.usuariosService.obtenerUsuarioPorId(
      Number(id),
      request.user,
    );
  }

  @Patch(':id')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  async actualizarUsuario(
    @Param('id') id: string,
    @Body() dto: ActualizarUsuarioDto,
    @Req() request: any,
  ) {
    return this.usuariosService.actualizarUsuario(
      Number(id),
      dto,
      request.user,
    );
  }

  @Patch(':id/estado')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  async cambiarEstadoUsuario(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoUsuarioDto,
    @Req() request: any,
  ) {
    return this.usuariosService.cambiarEstadoUsuario(
      Number(id),
      dto,
      request.user,
    );
  }

  @Patch(':id/comision')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  async actualizarComision(
    @Param('id') id: string,
    @Body() dto: ActualizarComisionDto,
    @Req() request: any,
  ) {
    return this.usuariosService.actualizarComision(
      Number(id),
      dto,
      request.user,
    );
  }
}
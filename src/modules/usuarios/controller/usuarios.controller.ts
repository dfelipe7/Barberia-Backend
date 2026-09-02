import { Controller, Post, Get, Patch, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { KeycloakAuthGuard } from '../../../auth/keycloak-auth/keycloak-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { ActualizarUsuarioDto } from '../dto/actualizar-usuario.dto';
import { CambiarEstadoUsuarioDto } from '../dto/cambiar-estado-usuario.dto';
import { UsuariosService } from '../service/usuarios.service';
import { ConfigurarBarberoDto } from '../dto/configurar-barbero.dto';
import { BarberosService } from '../service/barberos.service';

@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly barberosService: BarberosService,
  ) {}

  @Post('me/barbero')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({ summary: 'Configura el perfil del usuario actual como barbero' })
  async configurarMiPerfilComoBarbero(
    @Req() request: any,
    @Body() dto: ConfigurarBarberoDto,
  ) {
    return this.barberosService.configurarBarbero(request.user.sub, dto);
  }

  @Post('sincronizar-superadmin')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Sincroniza el usuario superadmin en la base de datos' })
  async sincronizarSuperadmin() {
    return this.usuariosService.sincronizarSuperadmin();
  }

  @Post(':id/barbero')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Configura el perfil de un usuario existente como barbero' })
  async configurarBarberoPorId(
    @Param('id') id: string,
    @Body() dto: ConfigurarBarberoDto,
  ) {
    return this.barberosService.configurarBarberoPorId(Number(id), dto);
  }

  @Get(':id')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({ summary: 'Obtiene los datos de un usuario por su ID' })
  async obtenerUsuarioPorId(
    @Param('id') id: string,
    @Req() request: any,
  ) {
    return this.usuariosService.obtenerUsuarioPorId(Number(id), request.user);
  }

  @Patch(':id')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({ summary: 'Actualiza los datos de un usuario' })
  async actualizarUsuario(
    @Param('id') id: string,
    @Body() dto: ActualizarUsuarioDto,
    @Req() request: any,
  ) {
    return this.usuariosService.actualizarUsuario(Number(id), dto, request.user);
  }

  @Patch(':id/estado')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Cambia el estado (activo/inactivo) de un usuario' })
  async cambiarEstadoUsuario(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoUsuarioDto,
    @Req() request: any,
  ) {
    return this.usuariosService.cambiarEstadoUsuario(Number(id), dto, request.user);
  }
}
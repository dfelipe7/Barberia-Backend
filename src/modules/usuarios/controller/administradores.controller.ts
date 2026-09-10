import { Controller, Post, Get, Delete, Patch, Body, UseGuards, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { KeycloakAuthGuard } from '../../../auth/keycloak-auth/keycloak-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { CrearAdministradorDto } from '../dto/crear-administrador.dto';
import { AdministradoresService } from '../service/administradores.service';

@ApiTags('Administradores')
@ApiBearerAuth()
@Controller('usuarios/administradores')
export class AdministradoresController {
  constructor(private readonly administradoresService: AdministradoresService) {}

  @Post()
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Crea un nuevo usuario administrador' })
  async crearAdministrador(@Body() dto: CrearAdministradorDto) {
    return this.administradoresService.crearAdministrador(dto);
  }

  @Get()
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Obtiene la lista de todos los administradores' })
  async obtenerAdministradores() {
    return this.administradoresService.obtenerAdministradores();
  }

  @Patch(':id/estado')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Cambia el estado (ACTIVO/INACTIVO) del rol de Administrador de un usuario' })
  async cambiarEstadoAdministrador(
    @Param('id', ParseIntPipe) usuarioId: number,
    @Body('estado') estado: string
  ) {
    return this.administradoresService.cambiarEstadoAdministrador(usuarioId, estado);
  }
}

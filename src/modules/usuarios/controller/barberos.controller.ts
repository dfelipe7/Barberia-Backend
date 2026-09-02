import { Controller, Post, Get, Patch, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { KeycloakAuthGuard } from '../../../auth/keycloak-auth/keycloak-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { CrearBarberoDto } from '../dto/crear-barbero.dto';
import { ActualizarComisionDto } from '../dto/actualizar-comision.dto';
import { CambiarEstadoUsuarioDto } from '../dto/cambiar-estado-usuario.dto';
import { BarberosService } from '../service/barberos.service';

@ApiTags('Barberos')
@ApiBearerAuth()
@Controller('usuarios/barberos')
export class BarberosController {
  constructor(private readonly barberosService: BarberosService) {}

  @Post()
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Crea un nuevo usuario barbero' })
  async crearBarbero(@Body() dto: CrearBarberoDto) {
    return this.barberosService.crearBarbero(dto);
  }

  @Get('gestion')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Obtiene la lista de barberos para la vista de gestión' })
  async obtenerBarberosGestion() {
    return this.barberosService.obtenerBarberosGestion();
  }

  @Get()
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({ summary: 'Obtiene la lista pública/catálogo de barberos' })
  async obtenerBarberosCatalogo() {
    return this.barberosService.obtenerBarberosCatalogo();
  }

  @Patch(':id/comision')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Actualiza el porcentaje de comisión de un barbero' })
  async actualizarComision(
    @Param('id') id: string,
    @Body() dto: ActualizarComisionDto,
    @Req() request: any,
  ) {
    return this.barberosService.actualizarComision(Number(id), dto, request.user);
  }

  @Patch(':id/estado')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Cambia el estado (activo/inactivo) de un barbero' })
  async cambiarEstadoBarbero(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoUsuarioDto,
    @Req() request: any,
  ) {
    return this.barberosService.cambiarEstadoBarbero(Number(id), dto, request.user);
  }
}

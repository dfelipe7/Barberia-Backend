import { Controller, Post, Get, Patch, Body, Query, UseGuards, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiBadRequestResponse, ApiForbiddenResponse } from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { KeycloakAuthGuard } from '../../../auth/keycloak-auth/keycloak-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { CrearAdministradorDto } from '../dto/dto-peticion/crear-administrador.dto';
import { CambiarEstadoUsuarioDto } from '../dto/dto-peticion/cambiar-estado-usuario.dto';
import { FiltroAdministradoresDto } from '../dto/dto-peticion/filtro-administradores.dto';
import { AdministradorResponseDto } from '../dto/dto-respuesta/administrador-response.dto';
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
  @ApiOkResponse({ description: 'Administrador creado exitosamente.' })
  @ApiBadRequestResponse({ description: 'El correo ya está en uso o los datos son inválidos.' })
  async crearAdministrador(@Body() dto: CrearAdministradorDto) {
    return this.administradoresService.crearAdministrador(dto);
  }

  @Get()
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Obtiene la lista de todos los administradores con soporte de filtros' })
  @ApiOkResponse({ description: 'Lista de administradores obtenida.', type: AdministradorResponseDto, isArray: true })
  async obtenerAdministradores(@Query() filtro: FiltroAdministradoresDto) {
    return this.administradoresService.obtenerAdministradores(filtro);
  }

  @Patch(':id/estado')
  @UseGuards(KeycloakAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Cambia el estado (ACTIVO/INACTIVO) del rol de Administrador de un usuario' })
  @ApiOkResponse({ description: 'Estado del administrador actualizado exitosamente.' })
  @ApiForbiddenResponse({ description: 'No puedes cambiar el estado del rol administrador si no eres Superadmin.' })
  async cambiarEstadoAdministrador(
    @Param('id', ParseIntPipe) usuarioId: number,
    @Body() dto: CambiarEstadoUsuarioDto,
  ) {
    return this.administradoresService.cambiarEstadoAdministrador(usuarioId, dto.estado);
  }
}

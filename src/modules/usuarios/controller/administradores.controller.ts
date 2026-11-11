import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Query,
  UseGuards,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { CrearAdministradorDto } from '../dto/dto-peticion/crear-administrador.dto';
import { CambiarEstadoUsuarioDto } from '../dto/dto-peticion/cambiar-estado-usuario.dto';
import { FiltroAdministradoresDto } from '../dto/dto-peticion/filtro-administradores.dto';
import { AdministradorResponseDto } from '../dto/dto-respuesta/administrador-response.dto';
import { AdministradoresService } from '../service/administradores.service';

/**
 * Controlador de Gestión de Administradores de la Sede.
 *
 * @remarks
 * Gobierna las operaciones reservadas con exclusividad al rol `SUPERADMIN` de la barbería:
 * alta de nuevos administradores delegados, listado auditado de administradores y desactivación/reactivación
 * de membresías administrativas preservando el principio de menor privilegio.
 */
@ApiTags('Administradores')
@ApiBearerAuth()
@Controller('usuarios/administradores')
export class AdministradoresController {
  constructor(
    private readonly administradoresService: AdministradoresService,
  ) {}

  /**
   * Da de alta a un nuevo administrador en el contexto de la barbería activa.
   *
   * @param dto - Información de registro (email, nombre, apellido, teléfono).
   * @returns Datos del administrador creado con su membresía inicializada.
   * @throws {BadRequestException} Si el correo electrónico ya se encuentra registrado o contiene formato inválido.
   * @throws {ForbiddenException} Si el colaborador que ejecuta la acción no posee el rol SUPERADMIN.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Crea un nuevo usuario administrador' })
  @ApiOkResponse({ description: 'Administrador creado exitosamente.' })
  @ApiBadRequestResponse({
    description: 'El correo ya está en uso o los datos son inválidos.',
  })
  async crearAdministrador(@Body() dto: CrearAdministradorDto) {
    return this.administradoresService.crearAdministrador(dto);
  }

  /**
   * Consulta el listado de administradores de la barbería con soporte de filtrado por estado y término de búsqueda.
   *
   * @param filtro - Filtros opcionales de búsqueda y estado.
   * @returns Array de DTOs con la información de los administradores.
   * @throws {ForbiddenException} Si no cuenta con permisos de SUPERADMIN.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({
    summary:
      'Obtiene la lista de todos los administradores con soporte de filtros',
  })
  @ApiOkResponse({
    description: 'Lista de administradores obtenida.',
    type: AdministradorResponseDto,
    isArray: true,
  })
  async obtenerAdministradores(@Query() filtro: FiltroAdministradoresDto) {
    return this.administradoresService.obtenerAdministradores(filtro);
  }

  /**
   * Conmuta el estado de la membresía de administrador de un usuario (ACTIVO / INACTIVO).
   *
   * @param usuarioId - Identificador numérico del usuario evaluado.
   * @param dto - Contenedor con el nuevo estado a aplicar.
   * @returns Registro actualizado de la membresía.
   * @throws {ForbiddenException} Si el operador no es SUPERADMIN o intenta revocar la última cuenta fundadora.
   */
  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({
    summary:
      'Cambia el estado (ACTIVO/INACTIVO) del rol de Administrador de un usuario',
  })
  @ApiOkResponse({
    description: 'Estado del administrador actualizado exitosamente.',
  })
  @ApiForbiddenResponse({
    description:
      'No puedes cambiar el estado del rol administrador si no eres Superadmin.',
  })
  async cambiarEstadoAdministrador(
    @Param('id', ParseIntPipe) usuarioId: number,
    @Body() dto: CambiarEstadoUsuarioDto,
  ) {
    return this.administradoresService.cambiarEstadoAdministrador(
      usuarioId,
      dto.estado,
    );
  }
}

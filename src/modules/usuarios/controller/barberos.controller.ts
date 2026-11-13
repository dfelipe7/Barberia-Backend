import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { crearMulterOptions } from '../../../common/config/multer.config';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Roles } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { CrearBarberoDto } from '../dto/dto-peticion/crear-barbero.dto';
import { ActualizarComisionDto } from '../dto/dto-peticion/actualizar-comision.dto';
import { CambiarEstadoUsuarioDto } from '../dto/dto-peticion/cambiar-estado-usuario.dto';
import { FiltroBarberosDto } from '../dto/dto-peticion/filtro-barberos.dto';
import { BarberoGestionDto } from '../dto/dto-respuesta/barbero-gestion.dto';
import { BarberoCatalogoDto } from '../dto/dto-respuesta/barbero-catalogo.dto';
import { BarberosService } from '../service/barberos.service';
import { ApiNegocioHeader } from '../../../common/decorators/api-negocio-header.decorator';
import { ClaimsSesionPersonal } from '../../../auth/sesion/sesion-personal';

/** Petición HTTP enriquecida con los claims de la sesión de personal autenticada. */
export interface RequestConUsuario {
  user?: Partial<ClaimsSesionPersonal>;
}

/**
 * Controlador de Gestión y Catálogo de Barberos.
 *
 * @remarks
 * Gobierna el ciclo de vida del personal de barbería: alta operativa, catálogo público
 * sin datos sensibles, configuración individual de porcentaje de comisión, estado de la membresía
 * y gestión de fotografías de perfil tanto por el propio barbero como por los administradores.
 */
@ApiTags('Barberos')
@ApiBearerAuth()
@Controller('usuarios/barberos')
export class BarberosController {
  constructor(private readonly barberosService: BarberosService) {}

  /**
   * Da de alta a un barbero en la sede activa vinculando opcionalmente su porcentaje de comisión inicial.
   *
   * @param dto - Información personal y laboral del barbero.
   * @returns Datos del barbero creado con su ficha inicializada.
   * @throws {BadRequestException} Si los datos son inválidos o el correo ya se encuentra en uso.
   * @throws {ForbiddenException} Si el usuario carece de permisos de administración.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Crea un nuevo usuario barbero' })
  @ApiOkResponse({ description: 'Barbero creado exitosamente.' })
  @ApiBadRequestResponse({
    description: 'El correo ya está en uso o los datos son inválidos.',
  })
  async crearBarbero(@Body() dto: CrearBarberoDto) {
    return this.barberosService.crearBarbero(dto);
  }

  /**
   * Retorna la lista de barberos para el módulo de administración, incluyendo comisiones y estados.
   *
   * @param filtro - Filtros administrativos de búsqueda y estado.
   * @returns Listado de barberos en formato `BarberoGestionDto`.
   */
  @Get('gestion')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({
    summary:
      'Obtiene la lista de barberos para la vista de gestión con filtros',
  })
  @ApiOkResponse({
    description: 'Lista de barberos obtenida.',
    type: BarberoGestionDto,
    isArray: true,
  })
  async obtenerBarberosGestion(@Query() filtro: FiltroBarberosDto) {
    return this.barberosService.obtenerBarberosGestion(filtro);
  }

  /**
   * Catálogo público de barberos activos para el flujo de reservas y selección por clientes.
   *
   * @remarks
   * El `id` devuelto es `Barbero.id` (el que consumen la disponibilidad y la reserva).
   * Oculta datos sensibles como comisiones, teléfonos privados o direcciones de correo.
   *
   * @param filtro - Filtro opcional por nombre o especialidad.
   * @returns Listado público en formato `BarberoCatalogoDto`.
   */
  @Get()
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Obtiene la lista pública/catálogo de barberos con filtros',
    description:
      'Catálogo PÚBLICO de la barbería de la petición. El `id` devuelto es el Barbero.id: es el valor que consumen la disponibilidad y la reserva.',
  })
  @ApiOkResponse({
    description:
      'Catálogo público (sin datos sensibles como comisión o email).',
    type: BarberoCatalogoDto,
    isArray: true,
  })
  async obtenerBarberosCatalogo(@Query() filtro: FiltroBarberosDto) {
    return this.barberosService.obtenerBarberosCatalogo(filtro);
  }

  /**
   * Actualiza el porcentaje de comisión pactado para un barbero.
   *
   * @param usuarioId - Identificador global del usuario (`Usuario.id`).
   * @param dto - Objeto con el nuevo porcentaje de comisión decimal o entero (ej. 45 para 45%).
   * @param request - Petición HTTP con datos del administrador que autoriza el cambio.
   * @returns Confirmación y porcentaje actualizado.
   * @throws {ForbiddenException} Si un administrador intenta alterar la comisión de un SUPERADMIN o no posee permisos.
   * @throws {NotFoundException} Si el barbero no existe en la sede actual.
   */
  @Patch(':usuarioId/comision')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({
    summary: 'Actualiza el porcentaje de comisión de un barbero',
    description:
      'El identificador es el Usuario.id de la persona cuyo perfil de barbero se actualiza.',
  })
  @ApiParam({
    name: 'usuarioId',
    description: 'ID del usuario (Usuario.id)',
    type: Number,
  })
  @ApiOkResponse({ description: 'Comisión actualizada exitosamente.' })
  @ApiForbiddenResponse({
    description:
      'No tienes permiso para actualizar la comisión de este usuario (ej. a un Superadmin).',
  })
  async actualizarComision(
    @Param('usuarioId') usuarioId: string,
    @Body() dto: ActualizarComisionDto,
    @Req() request: RequestConUsuario,
  ) {
    return this.barberosService.actualizarComision(
      Number(usuarioId),
      dto,
      request.user,
    );
  }

  /**
   * Conmuta el estado operativo del perfil de barbero (ACTIVO / INACTIVO).
   *
   * @param usuarioId - Identificador del usuario evaluado.
   * @param dto - Nuevo estado a asignar.
   * @param request - Petición HTTP con claims de autorización.
   * @returns Registro actualizado del barbero.
   * @throws {ForbiddenException} Si no cuenta con permisos suficientes.
   */
  @Patch(':usuarioId/estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Cambia el estado (activo/inactivo) de un barbero' })
  @ApiParam({
    name: 'usuarioId',
    description: 'ID del usuario (Usuario.id)',
    type: Number,
  })
  @ApiOkResponse({
    description: 'Rol de barbero activado o desactivado exitosamente.',
  })
  @ApiForbiddenResponse({
    description: 'No tienes permiso para desactivar el rol de este usuario.',
  })
  async cambiarEstadoBarbero(
    @Param('usuarioId') usuarioId: string,
    @Body() dto: CambiarEstadoUsuarioDto,
    @Req() request: RequestConUsuario,
  ) {
    return this.barberosService.cambiarEstadoBarbero(
      Number(usuarioId),
      dto,
      request.user,
    );
  }

  /**
   * Sube o reemplaza la foto de perfil del barbero que ha iniciado sesión.
   *
   * @param file - Archivo de imagen procesado por Multer.
   * @param request - Petición con la sesión del barbero.
   * @returns Confirmación y nueva URL pública de la foto.
   * @throws {BadRequestException} Si no se seleccionó archivo o el usuario no existe.
   */
  @Post('foto')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @UseInterceptors(FileInterceptor('foto', crearMulterOptions('barberos')))
  @ApiOperation({ summary: 'Sube la foto de perfil del barbero autenticado' })
  async subirMiFoto(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: RequestConUsuario,
  ) {
    return this.barberosService.subirMiFoto(request.user, file);
  }

  /**
   * Elimina la foto de perfil del barbero autenticado y remueve el archivo físico del disco.
   *
   * @param request - Petición con la sesión del barbero.
   * @returns Confirmación de eliminación.
   * @throws {BadRequestException} Si el usuario no fue encontrado.
   */
  @Delete('foto')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Elimina la foto de perfil del barbero autenticado',
  })
  async eliminarMiFoto(@Req() request: RequestConUsuario) {
    return this.barberosService.eliminarMiFoto(request.user);
  }

  /**
   * Sube o reemplaza la foto de perfil de un barbero específico por parte de un administrador.
   *
   * @param usuarioId - Identificador del usuario barbero (`Usuario.id`).
   * @param file - Archivo de imagen procesado.
   * @param request - Petición con la sesión del administrador.
   * @returns Confirmación y nueva URL pública de la foto.
   * @throws {BadRequestException} Si no se envió archivo.
   */
  @Post(':usuarioId/foto')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @UseInterceptors(FileInterceptor('foto', crearMulterOptions('barberos')))
  @ApiOperation({
    summary: 'Sube la foto de perfil de un barbero específico (Admin)',
  })
  @ApiParam({
    name: 'usuarioId',
    description: 'ID del usuario (Usuario.id)',
    type: Number,
  })
  async subirFotoBarberoPorId(
    @Param('usuarioId') usuarioId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() request: RequestConUsuario,
  ) {
    if (!file) {
      throw new BadRequestException('Debe seleccionar un archivo de imagen');
    }
    return this.barberosService.subirFotoBarbero(
      Number(usuarioId),
      file,
      request.user,
    );
  }
}

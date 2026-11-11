import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiConsumes,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { crearMulterOptions } from '../../../common/config/multer.config';
import { ServiciosService } from '../service/servicios.service';
import { CrearServicioDto } from '../dto/dto-peticion/crear-servicio.dto';
import { ActualizarServicioDto } from '../dto/dto-peticion/actualizar-servicio.dto';
import { CambiarEstadoServicioDto } from '../dto/dto-peticion/cambiar-estado-servicio.dto';
import { FiltroServiciosDto } from '../dto/dto-peticion/filtro-servicios.dto';
import { ServicioResponseDto } from '../dto/dto-respuesta/servicio-response.dto';
import { BarberoPorServicioDto } from '../dto/dto-respuesta/barbero-por-servicio.dto';
import { Roles } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { ApiNegocioHeader } from '../../../common/decorators/api-negocio-header.decorator';

/**
 * Controlador del Catálogo de Servicios y Asignación de Barberos.
 *
 * @remarks
 * Provee tanto las rutas públicas para el catálogo de clientes (consulta de servicios activos
 * y barberos habilitados para citas) como las operaciones protegidas por RBAC para la administración
 * de tarifas, duraciones, estado operativo (Soft Delete) y multimedia de servicios.
 */
@ApiTags('servicios')
@Controller('servicios')
export class ServiciosController {
  constructor(private readonly serviciosService: ServiciosService) {}

  /**
   * Crea un nuevo servicio en el catálogo de la sede activa.
   *
   * @remarks
   * Valida que los identificadores de barberos suministrados pertenezcan exclusivamente a la barbería actual
   * y se encuentren en estado `ACTIVO`. Restringido a administradores de sede.
   *
   * @param dto - Datos del nuevo servicio y lista opcional de IDs de barberos asignados.
   * @returns Datos del servicio creado con formato `ServicioResponseDto`.
   * @throws {ConflictException} Si ya existe un servicio con el mismo nombre en la sede.
   * @throws {BadRequestException} Si los barberos asociados no existen o están inactivos.
   * @throws {UnauthorizedException} Si el token JWT de administrador es inválido o no pertenece a la sede.
   * @throws {ForbiddenException} Si el usuario carece del rol SUPERADMIN o ADMINISTRADOR.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Crear un nuevo servicio con asignación opcional de barberos activos',
  })
  @ApiBody({ type: CrearServicioDto })
  @ApiResponse({
    status: 201,
    description: 'Servicio creado correctamente',
    type: ServicioResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o barberos inactivos/inexistentes',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya existe un servicio con este nombre',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  @HttpCode(HttpStatus.CREATED)
  async crearServicio(@Body() dto: CrearServicioDto) {
    return this.serviciosService.crearServicio(dto);
  }

  /**
   * Obtiene todos los servicios (activos e inactivos) para la vista administrativa con soporte de filtros.
   *
   * @param filtro - Criterios de búsqueda opcionales (nombre, estado).
   * @returns Listado integral de servicios de la barbería.
   */
  @Get('gestion')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Obtiene todos los servicios para la vista de gestión del panel administrativo con filtros',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista completa de servicios para administración',
    type: ServicioResponseDto,
    isArray: true,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async obtenerServiciosGestion(@Query() filtro: FiltroServiciosDto) {
    return this.serviciosService.obtenerServiciosGestion(filtro);
  }

  /**
   * Retorna los servicios activos que realiza un barbero específico.
   *
   * @remarks
   * Endpoint público utilizado cuando el cliente selecciona primero a su barbero de preferencia.
   * Valida pertenencia a la sede; si no pertenece o no está activo, responde 404.
   *
   * @param barberoId - ID del perfil de barbero (`Barbero.id`).
   * @returns Lista de servicios activos asociados a ese barbero.
   * @throws {NotFoundException} Si el barbero no existe o no pertenece a la sede actual.
   */
  @Get('barbero/:barberoId')
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Obtiene los servicios activos que realiza un barbero específico',
    description:
      'Endpoint PÚBLICO. El identificador es el Barbero.id (el mismo que devuelve el catálogo y que consume la disponibilidad). Si el barbero no pertenece a la barbería de la petición, responde 404.',
  })
  @ApiParam({
    name: 'barberoId',
    description: 'ID del perfil de barbero (Barbero.id)',
    type: Number,
    example: 3,
  })
  @ApiResponse({
    status: 200,
    description: 'Servicios activos del barbero',
    type: ServicioResponseDto,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'El identificador de barbero no es un número válido',
  })
  @ApiNotFoundResponse({
    description: 'El barbero no existe en esta barbería o no está activo',
  })
  async obtenerServiciosPorBarbero(
    @Param('barberoId', ParseIntPipe) barberoId: number,
  ) {
    return this.serviciosService.obtenerServiciosPorBarbero(barberoId);
  }

  /**
   * Obtiene la lista de barberos activos asignados para realizar un servicio determinado.
   *
   * @remarks
   * Endpoint público (HE-04-HU-02) consumido en el flujo de reserva cuando el cliente selecciona el servicio
   * y procede a elegir al profesional. Devuelve una lista vacía `[]` si ningún barbero está asignado.
   *
   * @param servicioId - Identificador numérico del servicio.
   * @returns Lista de barberos capacitados (`BarberoPorServicioDto`).
   * @throws {NotFoundException} Si el servicio no existe o no se encuentra activo en la sede.
   */
  @Get(':servicioId/barberos')
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Obtiene los barberos activos que pueden realizar un servicio',
    description:
      'Endpoint PÚBLICO. Devuelve los barberos activos asignados al servicio activo indicado, con el ID de barbero que consume el endpoint de disponibilidad. Devuelve una lista vacía si ningún barbero ofrece el servicio (el frontend muestra el mensaje informativo). Responde 404 si el servicio no existe o está inactivo.',
  })
  @ApiParam({
    name: 'servicioId',
    description: 'ID numérico del servicio',
    type: Number,
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description:
      'Barberos activos que prestan el servicio (puede ser una lista vacía)',
    type: BarberoPorServicioDto,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'El identificador de servicio no es un número válido',
  })
  @ApiNotFoundResponse({ description: 'El servicio no existe o está inactivo' })
  async obtenerBarberosPorServicio(
    @Param('servicioId', ParseIntPipe) servicioId: number,
  ): Promise<BarberoPorServicioDto[]> {
    return this.serviciosService.obtenerBarberosPorServicio(servicioId);
  }

  /**
   * Retorna el catálogo público de servicios activos para clientes y agendamiento de citas.
   *
   * @remarks
   * Endpoint público sin requerimiento de autenticación. Filtra estrictamente por la sede resuelta
   * en el contexto de la petición.
   *
   * @param filtro - Filtro opcional por coincidencia de texto.
   * @returns Lista de servicios activos en formato `ServicioResponseDto`.
   */
  @Get()
  @ApiNegocioHeader()
  @ApiOperation({
    summary:
      'Obtiene el catálogo público de servicios activos para clientes y reservas con soporte de búsqueda',
    description:
      'Catálogo PÚBLICO de la barbería de la petición. Solo devuelve servicios del negocio resuelto por el contexto (subdominio o cabecera X-Negocio-Slug), con los barberos que los prestan (Barbero.id).',
  })
  @ApiResponse({
    status: 200,
    description: 'Catálogo de servicios activos disponibles',
    type: ServicioResponseDto,
    isArray: true,
  })
  async obtenerServiciosCatalogo(@Query() filtro: FiltroServiciosDto) {
    return this.serviciosService.obtenerServiciosCatalogo(filtro);
  }

  /**
   * Obtiene la ficha detallada de un servicio por su identificador.
   *
   * @param id - Identificador numérico del servicio en formato string.
   * @returns Ficha completa del servicio y barberos asignados.
   * @throws {NotFoundException} Si el servicio no existe en la sede actual.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener un servicio específico por su ID' })
  @ApiParam({
    name: 'id',
    description: 'ID numérico del servicio',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Servicio encontrado',
    type: ServicioResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
  async obtenerServicioPorId(@Param('id') id: string) {
    return this.serviciosService.obtenerServicioPorId(Number(id));
  }

  /**
   * Altera el estado operativo de un servicio (borrado lógico / Soft Delete).
   *
   * @param id - Identificador del servicio.
   * @param dto - Nuevo estado deseado (`ACTIVO` o `INACTIVO`).
   * @returns Servicio con el nuevo estado persistido.
   * @throws {NotFoundException} Si el servicio no existe en la sede.
   */
  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambia el estado (activo/inactivo) de un servicio (Soft Delete)',
  })
  @ApiParam({ name: 'id', description: 'ID del servicio', type: Number })
  @ApiBody({ type: CambiarEstadoServicioDto })
  @ApiResponse({
    status: 200,
    description: 'Estado del servicio actualizado correctamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos (debe ser ACTIVO o INACTIVO)',
  })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
  async cambiarEstadoServicio(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoServicioDto,
  ) {
    return this.serviciosService.cambiarEstadoServicio(Number(id), dto);
  }

  /**
   * Modifica los datos descriptivos, económicos o las asignaciones de barberos de un servicio.
   *
   * @param id - Identificador del servicio.
   * @param dto - Datos modificables del servicio (nombre, precio, duración, fotoUrl, barberoIds).
   * @returns Servicio actualizado.
   * @throws {NotFoundException} Si el servicio no existe en la sede.
   * @throws {ConflictException} Si el nuevo nombre colisiona con otro servicio de la misma barbería.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualizar los datos o asignaciones de un servicio existente',
  })
  @ApiParam({ name: 'id', description: 'ID del servicio', type: Number })
  @ApiBody({ type: ActualizarServicioDto })
  @ApiResponse({
    status: 200,
    description: 'Servicio actualizado correctamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Uno o más barberos no existen o están inactivos',
  })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe otro servicio con ese nombre',
  })
  async actualizarServicio(
    @Param('id') id: string,
    @Body() dto: ActualizarServicioDto,
  ) {
    return this.serviciosService.actualizarServicio(Number(id), dto);
  }

  /**
   * Sube o sustituye la imagen promocional de un servicio.
   *
   * @param id - Identificador del servicio.
   * @param file - Archivo de imagen validado y almacenado temporalmente por Multer.
   * @returns Objeto con mensaje y nueva URL pública del archivo.
   * @throws {BadRequestException} Si no se adjuntó un archivo válido.
   * @throws {NotFoundException} Si el servicio no existe en la sede.
   */
  @Post(':id/foto')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('foto', crearMulterOptions('servicios')))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube o actualiza la foto de un servicio (Admin)' })
  @ApiParam({
    name: 'id',
    description: 'ID numérico del servicio',
    type: Number,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        foto: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Foto del servicio actualizada correctamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Archivo no proporcionado o formato inválido',
  })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
  async subirFotoServicio(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Debe seleccionar un archivo de imagen');
    }
    return this.serviciosService.subirFotoServicio(Number(id), file);
  }

  /**
   * Elimina la foto asociada al servicio y borra físicamente el archivo del servidor de almacenamiento.
   *
   * @param id - Identificador del servicio.
   * @returns Confirmación de eliminación.
   * @throws {NotFoundException} Si el servicio no existe en la sede actual.
   */
  @Delete(':id/foto')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elimina la foto de un servicio' })
  @ApiParam({
    name: 'id',
    description: 'ID numérico del servicio',
    type: Number,
  })
  @ApiResponse({ status: 200, description: 'Foto eliminada correctamente' })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
  async eliminarFotoServicio(@Param('id') id: string) {
    return this.serviciosService.eliminarFotoServicio(Number(id));
  }
}

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
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { crearMulterOptions } from '../../../common/config/multer.config';
import { ServiciosService } from '../service/servicios.service';
import { CrearServicioDto } from '../dto/dto-peticion/crear-servicio.dto';
import { ActualizarServicioDto } from '../dto/dto-peticion/actualizar-servicio.dto';
import { CambiarEstadoServicioDto } from '../dto/dto-peticion/cambiar-estado-servicio.dto';
import { FiltroServiciosDto } from '../dto/dto-peticion/filtro-servicios.dto';
import { ServicioResponseDto } from '../dto/dto-respuesta/servicio-response.dto';
import { Roles } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

@ApiTags('servicios')
@Controller('servicios')
export class ServiciosController {
    constructor(
        private readonly serviciosService: ServiciosService,
    ) { }

    /**
     * POST /servicios
     * Crea un nuevo servicio en el catálogo.
     * Valida que los barberos indicados en barberoIds existan y estén ACTIVOS.
     * Acceso restringido: SUPERADMIN y ADMINISTRADOR.
     */
    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('SUPERADMIN', 'ADMINISTRADOR')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Crear un nuevo servicio con asignación opcional de barberos activos' })
    @ApiBody({ type: CrearServicioDto })
    @ApiResponse({ status: 201, description: 'Servicio creado correctamente', type: ServicioResponseDto })
    @ApiResponse({ status: 400, description: 'Datos inválidos o barberos inactivos/inexistentes' })
    @ApiResponse({ status: 409, description: 'Ya existe un servicio con este nombre' })
    @ApiResponse({ status: 401, description: 'No autenticado' })
    @ApiResponse({ status: 403, description: 'No autorizado' })
    @HttpCode(HttpStatus.CREATED)
    async crearServicio(@Body() dto: CrearServicioDto) {
        return this.serviciosService.crearServicio(dto);
    }

    /**
     * GET /servicios/gestion
     * Vista de gestión administrativa: Retorna TODOS los servicios (activos e inactivos) con soporte de filtros.
     * Acceso restringido: SUPERADMIN y ADMINISTRADOR.
     */
    @Get('gestion')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('SUPERADMIN', 'ADMINISTRADOR')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Obtiene todos los servicios para la vista de gestión del panel administrativo con filtros' })
    @ApiResponse({ status: 200, description: 'Lista completa de servicios para administración', type: ServicioResponseDto, isArray: true })
    @ApiResponse({ status: 401, description: 'No autenticado' })
    @ApiResponse({ status: 403, description: 'No autorizado' })
    async obtenerServiciosGestion(@Query() filtro: FiltroServiciosDto) {
        return this.serviciosService.obtenerServiciosGestion(filtro);
    }

    /**
     * GET /servicios/barbero/:barberoId
     * Retorna los servicios activos que ofrece un barbero específico.
     * Endpoint PÚBLICO: Utilizado cuando el cliente selecciona primero a su barbero favorito.
     */
    @Get('barbero/:barberoId')
    @ApiOperation({ summary: 'Obtiene los servicios activos que realiza un barbero específico' })
    @ApiParam({ name: 'barberoId', description: 'ID numérico del barbero', type: Number })
    @ApiResponse({ status: 200, description: 'Servicios activos del barbero', type: ServicioResponseDto, isArray: true })
    async obtenerServiciosPorBarbero(@Param('barberoId') barberoId: string) {
        return this.serviciosService.obtenerServiciosPorBarbero(Number(barberoId));
    }

    /**
     * GET /servicios
     * Catálogo público: Retorna únicamente los servicios ACTIVOS con opción de filtro por nombre.
     * Endpoint PÚBLICO: No requiere autenticación para que clientes y visitantes
     * puedan consultar el catálogo e iniciar su reserva sin restricciones.
     */
    @Get()
    @ApiOperation({ summary: 'Obtiene el catálogo público de servicios activos para clientes y reservas con soporte de búsqueda' })
    @ApiResponse({ status: 200, description: 'Catálogo de servicios activos disponibles', type: ServicioResponseDto, isArray: true })
    async obtenerServiciosCatalogo(@Query() filtro: FiltroServiciosDto) {
        return this.serviciosService.obtenerServiciosCatalogo(filtro);
    }

    /**
     * GET /servicios/:id
     * Obtiene el detalle de un servicio por su ID.
     * Disponible para roles autenticados: SUPERADMIN, ADMINISTRADOR y BARBERO.
     */
    @Get(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Obtener un servicio específico por su ID' })
    @ApiParam({ name: 'id', description: 'ID numérico del servicio', type: Number })
    @ApiResponse({ status: 200, description: 'Servicio encontrado', type: ServicioResponseDto })
    @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
    async obtenerServicioPorId(@Param('id') id: string) {
        return this.serviciosService.obtenerServicioPorId(Number(id));
    }

    /**
     * PATCH /servicios/:id/estado
     * Cambia el estado (ACTIVO / INACTIVO) de un servicio (borrado lógico).
     * Acceso restringido: SUPERADMIN y ADMINISTRADOR.
     */
    @Patch(':id/estado')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('SUPERADMIN', 'ADMINISTRADOR')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Cambia el estado (activo/inactivo) de un servicio (Soft Delete)' })
    @ApiParam({ name: 'id', description: 'ID del servicio', type: Number })
    @ApiBody({ type: CambiarEstadoServicioDto })
    @ApiResponse({ status: 200, description: 'Estado del servicio actualizado correctamente' })
    @ApiResponse({ status: 400, description: 'Datos inválidos (debe ser ACTIVO o INACTIVO)' })
    @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
    async cambiarEstadoServicio(
        @Param('id') id: string,
        @Body() dto: CambiarEstadoServicioDto,
    ) {
        return this.serviciosService.cambiarEstadoServicio(Number(id), dto);
    }

    /**
     * PATCH /servicios/:id
     * Actualiza los datos de un servicio (nombre, precio, duración, foto, barberos asignados).
     * Valida que los nuevos barberos asignados existan y estén ACTIVOS.
     * Acceso restringido: SUPERADMIN y ADMINISTRADOR.
     */
    @Patch(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('SUPERADMIN', 'ADMINISTRADOR')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Actualizar los datos o asignaciones de un servicio existente' })
    @ApiParam({ name: 'id', description: 'ID del servicio', type: Number })
    @ApiBody({ type: ActualizarServicioDto })
    @ApiResponse({ status: 200, description: 'Servicio actualizado correctamente' })
    @ApiResponse({ status: 400, description: 'Uno o más barberos no existen o están inactivos' })
    @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
    @ApiResponse({ status: 409, description: 'Ya existe otro servicio con ese nombre' })
    async actualizarServicio(
        @Param('id') id: string,
        @Body() dto: ActualizarServicioDto,
    ) {
        return this.serviciosService.actualizarServicio(Number(id), dto);
    }

    /**
     * POST /servicios/:id/foto
     * Sube o actualiza la foto de un servicio (almacenada en /uploads/servicios/).
     * Utiliza la configuración centralizada crearMulterOptions() para mantener el controlador limpio.
     * Acceso restringido: SUPERADMIN y ADMINISTRADOR.
     */
    @Post(':id/foto')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('SUPERADMIN', 'ADMINISTRADOR')
    @ApiBearerAuth()
    @UseInterceptors(FileInterceptor('foto', crearMulterOptions('servicios')))
    @ApiConsumes('multipart/form-data')
    @ApiOperation({ summary: 'Sube o actualiza la foto de un servicio (Admin)' })
    @ApiParam({ name: 'id', description: 'ID numérico del servicio', type: Number })
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
    @ApiResponse({ status: 200, description: 'Foto del servicio actualizada correctamente' })
    @ApiResponse({ status: 400, description: 'Archivo no proporcionado o formato inválido' })
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
     * DELETE /servicios/:id/foto
     * Elimina la foto de un servicio y borra el archivo físico del disco.
     * Acceso restringido: SUPERADMIN y ADMINISTRADOR.
     */
    @Delete(':id/foto')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('SUPERADMIN', 'ADMINISTRADOR')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Elimina la foto de un servicio' })
    @ApiParam({ name: 'id', description: 'ID numérico del servicio', type: Number })
    @ApiResponse({ status: 200, description: 'Foto eliminada correctamente' })
    @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
    async eliminarFotoServicio(@Param('id') id: string) {
        return this.serviciosService.eliminarFotoServicio(Number(id));
    }
}

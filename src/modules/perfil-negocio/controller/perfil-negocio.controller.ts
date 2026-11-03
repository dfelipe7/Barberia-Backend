import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { ApiNegocioHeader } from '../../../common/decorators/api-negocio-header.decorator';
import { crearMulterMemoryOptions } from '../../../common/config/multer.config';
import { PerfilNegocioService } from '../service/perfil-negocio.service';
import { RedesSocialesService } from '../service/redes-sociales.service';
import {
  ActualizarPerfilNegocioDto,
  ActualizarReferenciasPerfilDto,
} from '../dto/dto-peticion/actualizar-perfil-negocio.dto';
import {
  CrearRedSocialDto,
  ReemplazarRedesSocialesDto,
} from '../dto/dto-peticion/crear-red-social.dto';
import { ActualizarRedSocialDto } from '../dto/dto-peticion/actualizar-red-social.dto';
import { PerfilNegocioPublicoResponseDto } from '../dto/dto-respuesta/perfil-negocio-publico.response.dto';
import { PerfilNegocioGestionResponseDto } from '../dto/dto-respuesta/perfil-negocio-gestion.response.dto';
import { RedSocialResponseDto } from '../dto/dto-respuesta/red-social.response.dto';
import {
  LIMITE_BYTES_PNG,
  LIMITE_BYTES_SVG,
  RECURSOS_PERFIL,
} from '../perfil-negocio.constants';

/**
 * API del perfil de marca y ubicación de la barbería (Fases 14, 15 y 18).
 *
 * El negocio SIEMPRE es el del contexto de la petición (subdominio o
 * cabecera `X-Negocio-Slug`), validado por el servidor. Ninguna ruta acepta
 * un identificador de negocio: no hay forma de pedir el perfil de otra
 * barbería.
 *
 * Rutas:
 * - `GET /perfil-negocio`               -> PÚBLICA (marca y ubicación).
 * - `GET /perfil-negocio/gestion`      -> SUPERADMIN / ADMINISTRADOR.
 * - `PUT /perfil-negocio`               -> SUPERADMIN / ADMINISTRADOR.
 * - `PUT /perfil-negocio/referencias`   -> SUPERADMIN / ADMINISTRADOR.
 * - `GET /perfil-negocio/redes-sociales`           -> PÚBLICA.
 * - `PUT /perfil-negocio/redes-sociales`            -> SUPERADMIN / ADMINISTRADOR.
 * - `PATCH /perfil-negocio/redes-sociales/:id`      -> SUPERADMIN / ADMINISTRADOR.
 * - `DELETE /perfil-negocio/redes-sociales/:id`     -> SUPERADMIN / ADMINISTRADOR.
 * - `PATCH /perfil-negocio/redes-sociales/:id/activar` -> SUPERADMIN / ADMINISTRADOR.
 */
@ApiTags('perfil-negocio')
@Controller('perfil-negocio')
export class PerfilNegocioController {
  constructor(
    private readonly service: PerfilNegocioService,
    private readonly redesSocialesService: RedesSocialesService,
  ) {}

  /**
   * GET /perfil-negocio
   * Vista PÚBLICA de la marca y la ubicación de la barbería.
   *
   * No requiere autenticación. Si el negocio no tiene perfil configurado,
   * responde 200 con los campos a `null` y `configurado: false`.
   */
  @Get()
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Obtiene el perfil público de marca y ubicación de la barbería',
    description:
      'Endpoint PÚBLICO. Devuelve la identidad visual, el contenido y la ubicación de la barbería de la petición (subdominio o cabecera X-Negocio-Slug), con la URL del mapa DERIVADA de las coordenadas. Si la barbería todavía no ha configurado su perfil, responde 200 con los campos a null y `configurado: false`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Perfil público de la barbería',
    type: PerfilNegocioPublicoResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'La petición no tiene un contexto de negocio autorizado',
  })
  async obtenerPerfilPublico(): Promise<PerfilNegocioPublicoResponseDto> {
    return this.service.obtenerPerfilPublico();
  }

  /**
   * GET /perfil-negocio/gestion
   * Vista ADMINISTRATIVA del perfil: bloques de gestión y auditoría.
   *
   * Acceso restringido: SUPERADMIN y ADMINISTRADOR del negocio del contexto.
   */
  @Get('gestion')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Obtiene la configuración administrativa del perfil de la barbería',
    description:
      'Vista de gestión: agrupa el contenido, la ubicación y las referencias de archivo, e incluye la auditoría. Solo SUPERADMIN y ADMINISTRADOR del negocio de la petición.',
  })
  @ApiResponse({
    status: 200,
    description: 'Perfil administrativo de la barbería',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async obtenerPerfilGestion(): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.obtenerPerfilGestion();
  }

  /**
   * PUT /perfil-negocio
   * Actualiza la frase principal y la ubicación de la barbería.
   *
   * Semántica de REEMPLAZO: los campos omitidos se guardan como `null`.
   * Acceso restringido: SUPERADMIN y ADMINISTRADOR del negocio del contexto.
   */
  @Put()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualiza la frase principal y la ubicación de la barbería',
    description:
      'Reemplaza el bloque de contenido y ubicación del perfil. Las coordenadas deben enviarse juntas: una latitud sin longitud (o al revés) se rechaza. La URL del mapa se deriva de las coordenadas, no se envía.',
  })
  @ApiBody({ type: ActualizarPerfilNegocioDto })
  @ApiResponse({
    status: 200,
    description: 'Perfil actualizado correctamente',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos: coordenadas fuera de rango o coordenadas parciales',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async actualizarPerfil(
    @Body() dto: ActualizarPerfilNegocioDto,
  ): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.actualizarPerfil(dto);
  }

  /**
   * PUT /perfil-negocio/referencias
   * Actualiza las referencias a los archivos de la identidad visual.
   *
   * En esta fase NO se suben archivos: solo se guardan las referencias. La
   * carga física de imágenes es una fase posterior.
   *
   * Acceso restringido: SUPERADMIN y ADMINISTRADOR del negocio del contexto.
   */
  @Put('referencias')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualiza las referencias de los archivos de la identidad visual',
    description:
      'Reemplaza el bloque de referencias de archivo (favicon, banner, logo blanco y logo negro). Solo se guardan rutas o URLs: en esta fase NO se sube ningún archivo físico.',
  })
  @ApiBody({ type: ActualizarReferenciasPerfilDto })
  @ApiResponse({
    status: 200,
    description: 'Referencias actualizadas correctamente',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Referencia inválida: debe ser una ruta relativa o una URL http/https',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async actualizarReferencias(
    @Body() dto: ActualizarReferenciasPerfilDto,
  ): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.actualizarReferencias(dto);
  }

  /**
   * POST /perfil-negocio/favicon
   * Sube o reemplaza el FAVICON del negocio (SVG).
   */
  @Post('favicon')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('archivo', crearMulterMemoryOptions(LIMITE_BYTES_SVG)),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Sube o reemplaza el favicon (SVG) de la barbería',
    description:
      'El archivo se valida por su contenido real, se sanea (se eliminan scripts y referencias externas) y se guarda en el espacio del negocio. El nombre del archivo lo genera el servidor.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { archivo: { type: 'string', format: 'binary' } },
      required: ['archivo'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Recurso almacenado correctamente',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Archivo ausente, de formato incorrecto o SVG no válido',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async subirFavicon(
    @UploadedFile() archivo: Express.Multer.File,
  ): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.subirRecurso(RECURSOS_PERFIL.FAVICON, archivo);
  }

  /**
   * POST /perfil-negocio/banner
   * Sube o reemplaza el BANNER del negocio (PNG).
   */
  @Post('banner')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('archivo', crearMulterMemoryOptions(LIMITE_BYTES_PNG)),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Sube o reemplaza el banner (PNG) de la barbería',
    description:
      'El contenido se valida por su firma real (PNG), no por el nombre ni por el Content-Type declarado por el cliente.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { archivo: { type: 'string', format: 'binary' } },
      required: ['archivo'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Recurso almacenado correctamente',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Archivo ausente o de formato incorrecto',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async subirBanner(
    @UploadedFile() archivo: Express.Multer.File,
  ): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.subirRecurso(RECURSOS_PERFIL.BANNER, archivo);
  }

  /**
   * POST /perfil-negocio/logo-blanco
   * Sube o reemplaza el LOGO para fondos oscuros (SVG).
   */
  @Post('logo-blanco')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('archivo', crearMulterMemoryOptions(LIMITE_BYTES_SVG)),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Sube o reemplaza el logo para fondos oscuros (SVG)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { archivo: { type: 'string', format: 'binary' } },
      required: ['archivo'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Recurso almacenado correctamente',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Archivo ausente o SVG no válido' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async subirLogoBlanco(
    @UploadedFile() archivo: Express.Multer.File,
  ): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.subirRecurso(RECURSOS_PERFIL.LOGO_BLANCO, archivo);
  }

  /**
   * POST /perfil-negocio/logo-negro
   * Sube o reemplaza el LOGO para fondos claros (SVG).
   */
  @Post('logo-negro')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('archivo', crearMulterMemoryOptions(LIMITE_BYTES_SVG)),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Sube o reemplaza el logo para fondos claros (SVG)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { archivo: { type: 'string', format: 'binary' } },
      required: ['archivo'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Recurso almacenado correctamente',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Archivo ausente o SVG no válido' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async subirLogoNegro(
    @UploadedFile() archivo: Express.Multer.File,
  ): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.subirRecurso(RECURSOS_PERFIL.LOGO_NEGRO, archivo);
  }

  /**
   * DELETE /perfil-negocio/favicon
   * Elimina el favicon del negocio y su archivo físico.
   */
  @Delete('favicon')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elimina el favicon de la barbería' })
  @ApiResponse({
    status: 200,
    description: 'Recurso eliminado correctamente',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async eliminarFavicon(): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.eliminarRecurso(RECURSOS_PERFIL.FAVICON);
  }

  /**
   * DELETE /perfil-negocio/banner
   * Elimina el banner del negocio y su archivo físico.
   */
  @Delete('banner')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elimina el banner de la barbería' })
  @ApiResponse({
    status: 200,
    description: 'Recurso eliminado correctamente',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async eliminarBanner(): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.eliminarRecurso(RECURSOS_PERFIL.BANNER);
  }

  /**
   * DELETE /perfil-negocio/logo-blanco
   * Elimina el logo para fondos oscuros del negocio y su archivo físico.
   */
  @Delete('logo-blanco')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elimina el logo para fondos oscuros' })
  @ApiResponse({
    status: 200,
    description: 'Recurso eliminado correctamente',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async eliminarLogoBlanco(): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.eliminarRecurso(RECURSOS_PERFIL.LOGO_BLANCO);
  }

  /**
   * DELETE /perfil-negocio/logo-negro
   * Elimina el logo para fondos claros del negocio y su archivo físico.
   */
  @Delete('logo-negro')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elimina el logo para fondos claros' })
  @ApiResponse({
    status: 200,
    description: 'Recurso eliminado correctamente',
    type: PerfilNegocioGestionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async eliminarLogoNegro(): Promise<PerfilNegocioGestionResponseDto> {
    return this.service.eliminarRecurso(RECURSOS_PERFIL.LOGO_NEGRO);
  }

  // =========================================================================
  // REDES SOCIALES (Fase 18)
  // =========================================================================

  /**
   * GET /perfil-negocio/redes-sociales
   * Lista las redes sociales ACTIVAS del negocio.
   *
   * PÚBLICA: no requiere autenticación.
   */
  @Get('redes-sociales')
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Lista las redes sociales activas del negocio',
    description:
      'Endpoint PÚBLICO. Devuelve las redes sociales activas del negocio del contexto, ordenadas por `orden` ascendente.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de redes sociales activas',
    type: [RedSocialResponseDto],
  })
  @ApiResponse({ status: 403, description: 'Sin contexto de negocio' })
  async listarRedesSociales(): Promise<RedSocialResponseDto[]> {
    return this.redesSocialesService.listar();
  }

  /**
   * PUT /perfil-negocio/redes-sociales
   * Reemplaza el conjunto de redes sociales del negocio.
   *
   * Semántica de REEMPLAZO SUAVE: las redes ausentes se desactivan,
   * las presentes se crean o actualizan conservando su `id`.
   *
   * Acceso restringido: SUPERADMIN y ADMINISTRADOR del negocio del contexto.
   */
  @Put('redes-sociales')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reemplaza el conjunto de redes sociales del negocio',
    description:
      'Semántica de reemplazo suave: las redes ausentes se desactivan (soft-delete) y las presentes se crean o actualizan. El id de cada red se conserva para que el historial no se rompa.',
  })
  @ApiBody({ type: [CrearRedSocialDto] })
  @ApiResponse({
    status: 200,
    description: 'Redes sociales actualizadas',
    type: [RedSocialResponseDto],
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async reemplazarRedesSociales(
    @Body() body: ReemplazarRedesSocialesDto | CrearRedSocialDto[],
  ): Promise<RedSocialResponseDto[]> {
    const redes = Array.isArray(body) ? body : (body?.redes ?? []);
    return this.redesSocialesService.reemplazar(redes);
  }

  /**
   * PATCH /perfil-negocio/redes-sociales/:id
   * Actualiza parcialmente UNA red social (url, nombre u orden).
   *
   * - Solo las redes de tipo OTRO pueden cambiar de nombre.
   * - Debe enviarse al menos un campo.
   *
   * Acceso restringido: SUPERADMIN y ADMINISTRADOR del negocio del contexto.
   */
  @Patch('redes-sociales/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID de la red social' })
  @ApiOperation({
    summary: 'Actualiza una red social del negocio',
    description:
      'Cambia url, orden o nombre (este último solo si la red es de tipo OTRO). ' +
      'No admite cambiar el tipo ni el estado.',
  })
  @ApiBody({ type: ActualizarRedSocialDto })
  @ApiResponse({ status: 200, type: RedSocialResponseDto })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 404, description: 'La red no existe en este negocio' })
  @ApiResponse({
    status: 409,
    description: 'Conflicto de unicidad del nombre (OTRO)',
  })
  async actualizarRedSocial(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarRedSocialDto,
  ): Promise<RedSocialResponseDto> {
    return this.redesSocialesService.actualizar(id, dto);
  }

  /**
   * DELETE /perfil-negocio/redes-sociales/:id
   * Soft-delete: marca la red social como inactiva.
   *
   * Idempotente: si ya está desactivada, devuelve 200 con la fila tal cual.
   *
   * Acceso restringido: SUPERADMIN y ADMINISTRADOR del negocio del contexto.
   */
  @Delete('redes-sociales/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Desactiva una red social (soft delete)',
    description:
      'Marca la red como inactiva sin borrarla. Idempotente: desactivar una ya desactivada devuelve 200.',
  })
  @ApiParam({ name: 'id', description: 'ID de la red social' })
  @ApiResponse({ status: 200, type: RedSocialResponseDto })
  @ApiResponse({ status: 404, description: 'La red no existe en este negocio' })
  async desactivarRedSocial(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<RedSocialResponseDto> {
    return this.redesSocialesService.desactivar(id);
  }

  /**
   * PATCH /perfil-negocio/redes-sociales/:id/activar
   * Reactiva una red social previamente desactivada.
   *
   * Idempotente: activar una ya activa devuelve 200.
   *
   * Acceso restringido: SUPERADMIN y ADMINISTRADOR del negocio del contexto.
   */
  @Patch('redes-sociales/:id/activar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactiva una red social desactivada',
    description: 'Idempotente: activar una ya activa devuelve 200.',
  })
  @ApiParam({ name: 'id', description: 'ID de la red social' })
  @ApiResponse({ status: 200, type: RedSocialResponseDto })
  @ApiResponse({ status: 404, description: 'La red no existe en este negocio' })
  @ApiResponse({
    status: 409,
    description: 'Ya hay otra activa con el mismo (tipo, nombre)',
  })
  async activarRedSocial(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<RedSocialResponseDto> {
    return this.redesSocialesService.activar(id);
  }
}

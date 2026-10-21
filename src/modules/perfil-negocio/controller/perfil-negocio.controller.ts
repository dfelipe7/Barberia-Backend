import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  ActualizarPerfilNegocioDto,
  ActualizarReferenciasPerfilDto,
} from '../dto/dto-peticion/actualizar-perfil-negocio.dto';
import { PerfilNegocioPublicoResponseDto } from '../dto/dto-respuesta/perfil-negocio-publico.response.dto';
import { PerfilNegocioGestionResponseDto } from '../dto/dto-respuesta/perfil-negocio-gestion.response.dto';
import {
  LIMITE_BYTES_PNG,
  LIMITE_BYTES_SVG,
  RECURSOS_PERFIL,
} from '../perfil-negocio.constants';

/**
 * API del perfil de marca y ubicación de la barbería (Fase 14).
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
 */
@ApiTags('perfil-negocio')
@Controller('perfil-negocio')
export class PerfilNegocioController {
  constructor(private readonly service: PerfilNegocioService) {}

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
   *
   * El archivo se valida por su CONTENIDO real, se sanea y se guarda con un
   * nombre generado por el servidor en el espacio del negocio.
   *
   * Acceso restringido: SUPERADMIN y ADMINISTRADOR del negocio del contexto.
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
   *
   * Primero se limpia la referencia del perfil y después se borra el archivo:
   * nunca queda una referencia rota.
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
}

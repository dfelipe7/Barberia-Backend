import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiNegocioHeader } from '../../../common/decorators/api-negocio-header.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { Roles } from '../../../auth/roles/roles.decorator';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { ActualizarDescuentoDto } from '../dto/dto-peticion/actualizar-descuento.dto';
import { CambiarEstadoDescuentoDto } from '../dto/dto-peticion/cambiar-estado-descuento.dto';
import { CrearDescuentoDto } from '../dto/dto-peticion/crear-descuento.dto';
import { EvaluarDescuentosBatchDto } from '../dto/dto-peticion/evaluar-descuentos-batch.dto';
import { DescuentoAplicableResponseDto } from '../dto/dto-respuesta/descuento-aplicable-response.dto';
import { DescuentosBatchResponseDto } from '../dto/dto-respuesta/descuentos-batch-response.dto';
import {
  DescuentoActualizadoResponseDto,
  DescuentoCreadoResponseDto,
  DescuentoEstadoResponseDto,
  DescuentoResponseDto,
  ListaDescuentosResponseDto,
} from '../dto/dto-respuesta/descuento-response.dto';
import { DescuentosFacade } from '../facade/descuentos.facade';

@ApiTags('descuentos')
@Controller('descuentos')
export class DescuentosController {
  constructor(private readonly facade: DescuentosFacade) {}

  /**
   * GET /descuentos
   * Lista todos los descuentos configurados en el negocio activo (HE-10-HU-01).
   * Solo SUPERADMIN y ADMINISTRADOR del negocio pueden consultar.
   * Lista vacía responde 200 con array vacío y mensaje descriptivo.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiNegocioHeader()
  @ApiOperation({
    summary:
      'Consultar los descuentos configurados (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Devuelve la lista de descuentos registrados en el negocio activo, incluyendo tipo, porcentaje, días aplicables, estado y el elemento (producto o servicio) asociado. Una lista vacía responde 200 con array vacío y mensaje descriptivo sin error técnico.',
  })
  @ApiOkResponse({
    description: 'Lista de descuentos configurados',
    type: ListaDescuentosResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'No autorizado (solo SUPERADMIN o ADMINISTRADOR del negocio)',
  })
  listar(): Promise<ListaDescuentosResponseDto> {
    return this.facade.listar();
  }

  /**
   * GET /descuentos/aplicable/producto/:productoId
   * Evalúa el descuento aplicable a un producto en el momento actual (HE-10-HU-05).
   * Determina el día actual en la zona horaria oficial del negocio y calcula el precio final.
   * Endpoint de consulta pública del tenant para catálogo y compras.
   */
  @Get('aplicable/producto/:productoId')
  @HttpCode(HttpStatus.OK)
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Visualizar descuento aplicable a un producto (HE-10-HU-05)',
    description:
      'Evalúa si el producto tiene un descuento activo y aplicable para el día de hoy según la zona horaria del negocio. Devuelve precio original, porcentaje y precio final redondeado. Un producto inexistente o de otro negocio responde 404.',
  })
  @ApiParam({
    name: 'productoId',
    example: 1,
    description: 'ID del producto a evaluar',
  })
  @ApiOkResponse({
    description: 'Evaluación del descuento aplicable al producto',
    type: DescuentoAplicableResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'El identificador del producto no es un entero positivo',
  })
  @ApiNotFoundResponse({
    description: 'El producto no se encuentra disponible en este negocio',
  })
  evaluarProducto(
    @Param('productoId', ParseIntPipe) productoId: number,
  ): Promise<DescuentoAplicableResponseDto> {
    if (productoId <= 0) {
      throw new BadRequestException(
        'El identificador del producto debe ser un entero positivo',
      );
    }

    return this.facade.evaluarDescuentoProducto(productoId);
  }

  /**
   * GET /descuentos/aplicable/servicio/:servicioId
   * Evalúa el descuento aplicable a un servicio para una fecha de cita (HE-10-HU-05).
   * Si se omite la fecha, devuelve el precio base y condiciones registradas sin precio final (CA-08).
   * Endpoint de consulta pública del tenant para catálogo y reservas.
   */
  @Get('aplicable/servicio/:servicioId')
  @HttpCode(HttpStatus.OK)
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Visualizar descuento aplicable a un servicio (HE-10-HU-05)',
    description:
      'Evalúa si el servicio tiene un descuento activo y aplicable para la fecha de cita indicada (?fecha=YYYY-MM-DD). Si no se envía fecha, responde precio base y condiciones sin precio promocional final. Un servicio inexistente o de otro negocio responde 404.',
  })
  @ApiParam({
    name: 'servicioId',
    example: 1,
    description: 'ID del servicio a evaluar',
  })
  @ApiQuery({
    name: 'fecha',
    required: false,
    example: '2026-11-13',
    description: 'Fecha de la cita (YYYY-MM-DD) para evaluar aplicabilidad',
  })
  @ApiOkResponse({
    description: 'Evaluación del descuento aplicable al servicio',
    type: DescuentoAplicableResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Identificador inválido o formato de fecha no válido (YYYY-MM-DD)',
  })
  @ApiNotFoundResponse({
    description: 'El servicio no se encuentra disponible en este negocio',
  })
  evaluarServicio(
    @Param('servicioId', ParseIntPipe) servicioId: number,
    @Query('fecha') fecha?: string,
  ): Promise<DescuentoAplicableResponseDto> {
    if (servicioId <= 0) {
      throw new BadRequestException(
        'El identificador del servicio debe ser un entero positivo',
      );
    }

    return this.facade.evaluarDescuentoServicio(servicioId, fecha);
  }

  /**
   * POST /descuentos/aplicables
   * Evalúa en lote los descuentos aplicables a múltiples productos y servicios (H3).
   */
  @Post('aplicables')
  @HttpCode(HttpStatus.OK)
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Evaluar descuentos en lote para productos y servicios (H3)',
    description:
      'Evalúa de forma eficiente en lote los descuentos aplicables para múltiples productos y servicios en el negocio resuelto por el contexto.',
  })
  @ApiOkResponse({
    description: 'Evaluación en lote de descuentos aplicables',
    type: DescuentosBatchResponseDto,
  })
  evaluarBatch(
    @Body() dto: EvaluarDescuentosBatchDto,
  ): Promise<DescuentosBatchResponseDto> {
    return this.facade.evaluarBatch(dto);
  }

  /**
   * GET /descuentos/:descuentoId
   * Consulta la configuración completa de un descuento registrado (HE-10-HU-03).
   * Devuelve porcentaje, días aplicables, estado registrado y el elemento asociado.
   */
  @Get(':descuentoId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiNegocioHeader()
  @ApiOperation({
    summary:
      'Consultar la configuración de un descuento (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Devuelve la configuración completa registrada de un descuento del negocio del contexto (porcentaje, días aplicables, estado y elemento). Un descuento inexistente o de otro negocio responde 404.',
  })
  @ApiParam({
    name: 'descuentoId',
    example: 1,
    description: 'ID del descuento',
  })
  @ApiOkResponse({
    description: 'Configuración del descuento',
    type: DescuentoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'El identificador del descuento no es un entero positivo',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'No autorizado (solo SUPERADMIN o ADMINISTRADOR)',
  })
  @ApiNotFoundResponse({
    description: 'El descuento no se encuentra disponible',
  })
  obtenerPorId(
    @Param('descuentoId', ParseIntPipe) descuentoId: number,
  ): Promise<DescuentoResponseDto> {
    if (descuentoId <= 0) {
      throw new BadRequestException(
        'El identificador del descuento debe ser un entero positivo',
      );
    }

    return this.facade.obtenerPorId(descuentoId);
  }

  /**
   * PATCH /descuentos/:descuentoId
   * Modifica porcentaje o días aplicables de un descuento existente (HE-10-HU-03).
   * Conserva el mismo registro (ID y asociación al elemento).
   */
  @Patch(':descuentoId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Modificar un descuento existente (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Actualiza el porcentaje o los días aplicables de un descuento existente dentro del negocio activo, conservando su ID y elemento asociado. Un porcentaje inválido o días vacíos no alteran la configuración guardada.',
  })
  @ApiParam({
    name: 'descuentoId',
    example: 1,
    description: 'ID del descuento',
  })
  @ApiBody({ type: ActualizarDescuentoDto })
  @ApiOkResponse({
    description: 'Descuento actualizado correctamente',
    type: DescuentoActualizadoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos: porcentaje fuera de 1-99, más de dos decimales, días vacíos/inválidos o sin campos para actualizar',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'No autorizado (solo SUPERADMIN o ADMINISTRADOR)',
  })
  @ApiNotFoundResponse({
    description: 'El descuento no se encuentra disponible',
  })
  actualizar(
    @Param('descuentoId', ParseIntPipe) descuentoId: number,
    @Body() dto: ActualizarDescuentoDto,
  ): Promise<DescuentoActualizadoResponseDto> {
    if (descuentoId <= 0) {
      throw new BadRequestException(
        'El identificador del descuento debe ser un entero positivo',
      );
    }

    return this.facade.actualizar(descuentoId, dto);
  }

  /**
   * PATCH /descuentos/:descuentoId/estado
   * Activa o desactiva un descuento del negocio activo (HE-10-HU-04).
   * Conserva el porcentaje, días y asociación al elemento.
   * SUPERADMIN y ADMINISTRADOR del negocio pueden activar y desactivar.
   */
  @Patch(':descuentoId/estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Activar o desactivar un descuento (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Activa o desactiva temporalmente la aplicación de un descuento conservando su porcentaje, días y elemento registrado. Solicitar el estado actual es idempotente y responde 200.',
  })
  @ApiParam({
    name: 'descuentoId',
    example: 1,
    description: 'ID del descuento',
  })
  @ApiBody({ type: CambiarEstadoDescuentoDto })
  @ApiOkResponse({
    description: 'Estado del descuento actualizado correctamente',
    type: DescuentoEstadoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o configuración no activable',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'No autorizado (solo SUPERADMIN o ADMINISTRADOR)',
  })
  @ApiNotFoundResponse({
    description: 'El descuento no se encuentra disponible',
  })
  cambiarEstado(
    @Param('descuentoId', ParseIntPipe) descuentoId: number,
    @Body() dto: CambiarEstadoDescuentoDto,
  ): Promise<DescuentoEstadoResponseDto> {
    if (descuentoId <= 0) {
      throw new BadRequestException(
        'El identificador del descuento debe ser un entero positivo',
      );
    }

    return this.facade.cambiarEstado(descuentoId, dto);
  }

  /**
   * POST /descuentos
   * Crea el único descuento de un producto o servicio del negocio activo.
   * SUPERADMIN y ADMINISTRADOR del negocio pueden crear.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiNegocioHeader()
  @ApiOperation({
    summary:
      'Crear un descuento para un producto o servicio (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Registra el único descuento de un producto o servicio del negocio del contexto. El descuento nace INACTIVO. Un segundo descuento para el mismo elemento responde 409, esté activo o inactivo. El negocio y el estado inicial los fija el servidor.',
  })
  @ApiBody({ type: CrearDescuentoDto })
  @ApiResponse({
    status: 201,
    description: 'Descuento creado correctamente',
    type: DescuentoCreadoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos: porcentaje fuera de 1-99, más de dos decimales o días ausentes/inválidos',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya existe un descuento configurado para el elemento',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'No autorizado (solo SUPERADMIN o ADMINISTRADOR)',
  })
  @ApiNotFoundResponse({
    description: 'El producto o servicio no pertenece al negocio activo',
  })
  crear(@Body() dto: CrearDescuentoDto): Promise<DescuentoCreadoResponseDto> {
    return this.facade.crear(dto);
  }
}

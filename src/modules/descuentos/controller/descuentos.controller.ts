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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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

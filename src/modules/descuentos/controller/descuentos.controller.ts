import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiNegocioHeader } from '../../../common/decorators/api-negocio-header.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { Roles } from '../../../auth/roles/roles.decorator';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { CrearDescuentoDto } from '../dto/dto-peticion/crear-descuento.dto';
import { DescuentoCreadoResponseDto } from '../dto/dto-respuesta/descuento-response.dto';
import { DescuentosFacade } from '../facade/descuentos.facade';

@ApiTags('descuentos')
@Controller('descuentos')
export class DescuentosController {
  constructor(private readonly facade: DescuentosFacade) {}

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

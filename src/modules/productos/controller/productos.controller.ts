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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { crearMulterMemoryOptions } from '../../../common/config/multer.config';
import { ApiNegocioHeader } from '../../../common/decorators/api-negocio-header.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { Roles } from '../../../auth/roles/roles.decorator';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { ActualizarProductoDto } from '../dto/dto-peticion/actualizar-producto.dto';
import { CrearProductoDto } from '../dto/dto-peticion/crear-producto.dto';
import {
  ProductoActualizadoResponseDto,
  ProductoRegistradoResponseDto,
  ProductoResponseDto,
  ProductosListadoResponseDto,
} from '../dto/dto-respuesta/producto-response.dto';
import { ProductosFacade } from '../facade/productos.facade';
import {
  LIMITE_BYTES_IMAGEN_PRODUCTO,
  LIMITE_DESCRIPCION_PRODUCTO,
  LIMITE_NOMBRE_PRODUCTO,
  PRECIO_MAXIMO_PRODUCTO,
  PRECIO_MINIMO_PRODUCTO,
} from '../productos.constants';

@ApiTags('productos')
@Controller('productos')
export class ProductosController {
  constructor(private readonly facade: ProductosFacade) {}

  /**
   * GET /productos
   * Listado administrativo del negocio activo. Incluye activos e inactivos y
   * responde una colección vacía con mensaje cuando no hay productos.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Consultar los productos registrados (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Devuelve los productos del negocio del contexto, activos e inactivos, ordenados por fecha de creación descendente. Si no hay productos, responde 200 con `productos: []` y el mensaje "No existen productos registrados".',
  })
  @ApiOkResponse({
    description: 'Listado de productos del negocio',
    type: ProductosListadoResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'No autorizado o negocio sin contexto válido',
  })
  listar(): Promise<ProductosListadoResponseDto> {
    return this.facade.listar();
  }

  /**
   * GET /productos/:productoId
   * Detalle administrativo del producto. Un producto de otro negocio responde
   * igual que uno inexistente para no revelar su existencia.
   */
  @Get(':productoId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Consultar el detalle de un producto (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Devuelve la información completa del producto dentro del negocio del contexto. Un producto inexistente o de otro negocio responde 404 con el mismo mensaje.',
  })
  @ApiParam({
    name: 'productoId',
    example: 1,
    description: 'ID del producto',
  })
  @ApiOkResponse({
    description: 'Detalle del producto',
    type: ProductoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'El identificador del producto no es un entero positivo',
  })
  @ApiNotFoundResponse({
    description: 'El producto no se encuentra disponible',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'No autorizado o negocio sin contexto válido',
  })
  obtenerPorId(
    @Param('productoId', ParseIntPipe) productoId: number,
  ): Promise<ProductoResponseDto> {
    if (productoId <= 0) {
      throw new BadRequestException(
        'El identificador del producto debe ser un entero positivo',
      );
    }

    return this.facade.obtenerPorId(productoId);
  }

  /**
   * PATCH /productos/:productoId
   * Edita un producto del negocio activo. Los campos omitidos no cambian.
   */
  @Patch(':productoId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Actualizar un producto (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Edita nombre, descripción, precio e imagen de un producto del negocio del contexto. La imagen se envía como archivo multipart en el campo `imagen`; `imagenUrl` no se acepta. Los campos omitidos no cambian y reenviar los mismos valores no modifica `actualizadoEn`. `descripcion: null` o vacía limpia la descripción. Sin campos ni imagen responde 400. Un producto inexistente o de otro negocio responde 404 con el mismo mensaje.',
  })
  @ApiParam({
    name: 'productoId',
    example: 1,
    description: 'ID del producto',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        nombre: {
          type: 'string',
          maxLength: LIMITE_NOMBRE_PRODUCTO,
          example: 'Cera para cabello',
          description: 'Si se omite, el nombre no cambia.',
        },
        descripcion: {
          type: 'string',
          maxLength: LIMITE_DESCRIPCION_PRODUCTO,
          nullable: true,
          example: 'Cera de fijación fuerte con acabado mate',
          description:
            'Si se omite, la descripción no cambia. Enviar null o cadena vacía para limpiarla.',
        },
        precio: {
          type: 'number',
          minimum: PRECIO_MINIMO_PRODUCTO,
          maximum: PRECIO_MAXIMO_PRODUCTO,
          example: 35000,
          description:
            'Si se omite, el precio no cambia. Mayor que cero, máximo dos decimales.',
        },
        imagen: {
          type: 'string',
          format: 'binary',
          description:
            'JPG, PNG o WEBP de máximo 5 MB. Si se omite, se conserva la imagen actual.',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Producto actualizado correctamente',
    type: ProductoActualizadoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos, sin campos para actualizar o formato/tamaño de imagen no permitido',
  })
  @ApiResponse({
    status: 409,
    description:
      'Ya existe un producto con este nombre en este negocio. Reintentar con otro nombre.',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  @ApiNotFoundResponse({
    description: 'El producto no se encuentra disponible',
  })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor(
      'imagen',
      crearMulterMemoryOptions(LIMITE_BYTES_IMAGEN_PRODUCTO),
    ),
  )
  actualizar(
    @Param('productoId', ParseIntPipe) productoId: number,
    @Body() dto: ActualizarProductoDto,
    @UploadedFile() imagen?: Express.Multer.File,
  ) {
    if (productoId <= 0) {
      throw new BadRequestException(
        'El identificador del producto debe ser un entero positivo',
      );
    }

    return this.facade.actualizar(productoId, dto, imagen);
  }

  /**
   * POST /productos
   * Registra un producto en el negocio activo. La imagen es opcional y se
   * valida por su contenido real si se adjunta.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiBearerAuth()
  @ApiNegocioHeader()
  @ApiOperation({
    summary: 'Registrar un producto con imagen opcional',
    description:
      'El negocio se toma del contexto autorizado, nunca del cuerpo. La imagen es opcional. El nombre es único por negocio: si ya existe, responde 409 y el cliente debe reintentar con otro nombre. No se admite Idempotency-Key.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['nombre', 'precio'],
      properties: {
        nombre: {
          type: 'string',
          maxLength: LIMITE_NOMBRE_PRODUCTO,
          example: 'Cera para cabello',
        },
        descripcion: {
          type: 'string',
          maxLength: LIMITE_DESCRIPCION_PRODUCTO,
          example: 'Cera de fijación fuerte con acabado mate',
        },
        precio: {
          type: 'number',
          minimum: PRECIO_MINIMO_PRODUCTO,
          maximum: PRECIO_MAXIMO_PRODUCTO,
          example: 35000,
          description: 'Mayor que cero, máximo dos decimales.',
        },
        imagen: {
          type: 'string',
          format: 'binary',
          description: 'JPG, PNG o WEBP de máximo 5 MB (opcional).',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Producto registrado correctamente',
    type: ProductoRegistradoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o formato/tamaño de imagen no permitido',
  })
  @ApiResponse({
    status: 409,
    description:
      'Ya existe un producto con este nombre en este negocio. Reintentar con otro nombre.',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Negocio inexistente o inactivo' })
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor(
      'imagen',
      crearMulterMemoryOptions(LIMITE_BYTES_IMAGEN_PRODUCTO),
    ),
  )
  registrar(
    @Body() dto: CrearProductoDto,
    @UploadedFile() imagen?: Express.Multer.File,
  ) {
    return this.facade.registrar(dto, imagen);
  }
}

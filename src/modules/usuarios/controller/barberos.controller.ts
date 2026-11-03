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
import { UsuariosRepository } from '../repository/usuarios.repository';
import { ApiNegocioHeader } from '../../../common/decorators/api-negocio-header.decorator';
import { ClaimsSesionPersonal } from '../../../auth/sesion/sesion-personal';

interface RequestConUsuario {
  user?: Partial<ClaimsSesionPersonal>;
}

@ApiTags('Barberos')
@ApiBearerAuth()
@Controller('usuarios/barberos')
export class BarberosController {
  constructor(
    private readonly barberosService: BarberosService,
    private readonly usuariosRepository: UsuariosRepository,
  ) {}

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
   * PATCH /usuarios/barberos/:usuarioId/comision
   *
   * `usuarioId` es el `Usuario.id` (identidad global de la persona), NO el
   * `Barbero.id`: esta ruta gestiona el perfil de barbero de una persona
   * concreta. Para operar sobre el perfil como recurso de la barbería (asignar
   * servicios, consultar disponibilidad) se usa `Barbero.id`.
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
   * PATCH /usuarios/barberos/:usuarioId/estado
   *
   * `usuarioId` es el `Usuario.id` (identidad global de la persona).
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

  @Post('foto')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @UseInterceptors(FileInterceptor('foto', crearMulterOptions('barberos')))
  @ApiOperation({ summary: 'Sube la foto de perfil del barbero autenticado' })
  async subirMiFoto(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: RequestConUsuario,
  ) {
    if (!file) {
      throw new BadRequestException('Debe seleccionar un archivo de imagen');
    }
    const usuarioId = request.user?.id ? Number(request.user.id) : null;
    const usuario = usuarioId
      ? await this.usuariosRepository.obtenerUsuarioPorId(usuarioId)
      : await this.usuariosRepository.obtenerUsuarioPorEmail(
          request.user?.email ?? '',
        );

    if (!usuario) {
      throw new BadRequestException('Usuario no encontrado');
    }
    return this.barberosService.subirFotoBarbero(usuario.id, file);
  }

  @Delete('foto')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({
    summary: 'Elimina la foto de perfil del barbero autenticado',
  })
  async eliminarMiFoto(@Req() request: RequestConUsuario) {
    const usuarioId = request.user?.id ? Number(request.user.id) : null;
    const usuario = usuarioId
      ? await this.usuariosRepository.obtenerUsuarioPorId(usuarioId)
      : await this.usuariosRepository.obtenerUsuarioPorEmail(
          request.user?.email ?? '',
        );

    if (!usuario) {
      throw new BadRequestException('Usuario no encontrado');
    }
    return this.barberosService.eliminarFotoBarbero(usuario.id);
  }

  /**
   * POST /usuarios/barberos/:usuarioId/foto
   *
   * `usuarioId` es el `Usuario.id` (identidad global de la persona).
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

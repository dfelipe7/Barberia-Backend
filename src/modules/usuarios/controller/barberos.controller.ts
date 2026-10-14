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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiBadRequestResponse, ApiForbiddenResponse } from '@nestjs/swagger';
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
  @ApiBadRequestResponse({ description: 'El correo ya está en uso o los datos son inválidos.' })
  async crearBarbero(@Body() dto: CrearBarberoDto) {
    return this.barberosService.crearBarbero(dto);
  }

  @Get('gestion')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Obtiene la lista de barberos para la vista de gestión con filtros' })
  @ApiOkResponse({ description: 'Lista de barberos obtenida.', type: BarberoGestionDto, isArray: true })
  async obtenerBarberosGestion(@Query() filtro: FiltroBarberosDto) {
    return this.barberosService.obtenerBarberosGestion(filtro);
  }

  @Get()
  @ApiOperation({ summary: 'Obtiene la lista pública/catálogo de barberos con filtros' })
  @ApiOkResponse({ description: 'Catálogo público (sin datos sensibles como comisión o email).', type: BarberoCatalogoDto, isArray: true })
  async obtenerBarberosCatalogo(@Query() filtro: FiltroBarberosDto) {
    return this.barberosService.obtenerBarberosCatalogo(filtro);
  }

  @Patch(':id/comision')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Actualiza el porcentaje de comisión de un barbero' })
  @ApiOkResponse({ description: 'Comisión actualizada exitosamente.' })
  @ApiForbiddenResponse({ description: 'No tienes permiso para actualizar la comisión de este usuario (ej. a un Superadmin).' })
  async actualizarComision(
    @Param('id') id: string,
    @Body() dto: ActualizarComisionDto,
    @Req() request: any,
  ) {
    return this.barberosService.actualizarComision(Number(id), dto, request.user);
  }

  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @ApiOperation({ summary: 'Cambia el estado (activo/inactivo) de un barbero' })
  @ApiOkResponse({ description: 'Rol de barbero activado o desactivado exitosamente.' })
  @ApiForbiddenResponse({ description: 'No tienes permiso para desactivar el rol de este usuario.' })
  async cambiarEstadoBarbero(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoUsuarioDto,
    @Req() request: any,
  ) {
    return this.barberosService.cambiarEstadoBarbero(Number(id), dto, request.user);
  }

  @Post('foto')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @UseInterceptors(FileInterceptor('foto', crearMulterOptions('barberos')))
  @ApiOperation({ summary: 'Sube la foto de perfil del barbero autenticado' })
  async subirMiFoto(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: any,
  ) {
    if (!file) {
      throw new BadRequestException('Debe seleccionar un archivo de imagen');
    }
    const usuarioId = request.user?.id ? Number(request.user.id) : null;
    const usuario = usuarioId
      ? await this.usuariosRepository.obtenerUsuarioPorId(usuarioId)
      : await this.usuariosRepository.obtenerUsuarioPorEmail(request.user?.email);

    if (!usuario) {
      throw new BadRequestException('Usuario no encontrado');
    }
    return this.barberosService.subirFotoBarbero(usuario.id, file);
  }

  @Delete('foto')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO')
  @ApiOperation({ summary: 'Elimina la foto de perfil del barbero autenticado' })
  async eliminarMiFoto(@Req() request: any) {
    const usuarioId = request.user?.id ? Number(request.user.id) : null;
    const usuario = usuarioId
      ? await this.usuariosRepository.obtenerUsuarioPorId(usuarioId)
      : await this.usuariosRepository.obtenerUsuarioPorEmail(request.user?.email);

    if (!usuario) {
      throw new BadRequestException('Usuario no encontrado');
    }
    return this.barberosService.eliminarFotoBarbero(usuario.id);
  }

  @Post(':id/foto')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @UseInterceptors(FileInterceptor('foto', crearMulterOptions('barberos')))
  @ApiOperation({ summary: 'Sube la foto de perfil de un barbero específico (Admin)' })
  async subirFotoBarberoPorId(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() request: any,
  ) {
    if (!file) {
      throw new BadRequestException('Debe seleccionar un archivo de imagen');
    }
    return this.barberosService.subirFotoBarbero(Number(id), file, request.user);
  }
}


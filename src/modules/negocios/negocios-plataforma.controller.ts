/**
 * Trazabilidad:
 * - REQ: Refactorización Arquitectónica Clean Controller
 * - Modelo ejecutor: gemini-2.5-pro
 * - Propósito: controlador delgado (Thin Controller) para la plataforma y directorio de tenants.
 * - Responsabilidad: recepción HTTP, validación de Guards/DTOs y delegación a NegociosPlataformaService.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CrearNegocioPlataformaDto } from './dto/crear-negocio-plataforma.dto';
import { CambiarEstadoNegocioDto } from './dto/cambiar-estado-negocio.dto';
import { NegocioPublicoDto } from './dto/negocio-publico.dto';
import { JwtSesionGuard } from '../../auth/guards/jwt-sesion.guard';
import { PlataformaAdminGuard } from './guards/plataforma-admin.guard';
import { NegociosPlataformaService } from './service/negocios-plataforma.service';

/**
 * Controlador de Gestión de Plataforma y Directorio de Negocios (Tenants).
 *
 * @remarks
 * Proporciona endpoints públicos para listar las barberías federadas en el directorio global,
 * y endpoints protegidos por `PlataformaAdminGuard` para dar de alta nuevos tenants (onboarding)
 * y administrar el ciclo de vida (activación / desactivación) de las sedes.
 */
@ApiTags('Plataforma - Directorio de Negocios')
@Controller('plataforma/negocios')
export class NegociosPlataformaController {
  constructor(private readonly service: NegociosPlataformaService) {}

  /**
   * Obtiene la lista de barberías activas para desplegar en el directorio público del SaaS.
   *
   * @returns Listado de sedes con su slug, nombre, ciudad y recursos visuales (logos/banners).
   */
  @Get('publico')
  @ApiOperation({
    summary:
      'Listar las barberías activas para el directorio público de la plataforma',
  })
  @ApiOkResponse({ type: [NegocioPublicoDto] })
  async listarBarberiasPublicas() {
    return this.service.listarBarberiasPublicas();
  }

  /**
   * Lista todas las barberías registradas en la plataforma con métricas consolidadas.
   *
   * @returns Lista de negocios con conteos agregados de barberos, servicios, reservas y clientes.
   */
  @Get()
  @ApiOperation({
    summary:
      'Listar todas las barberías registradas en la plataforma con estadísticas',
  })
  async listarBarberias() {
    return this.service.listarBarberias();
  }

  /**
   * Da de alta un nuevo negocio (tenant) en la plataforma vinculando opcionalmente a su administrador fundador.
   *
   * @param dto - Información requerida para la creación del negocio (nombre, slug, zona horaria, administrador).
   * @returns Datos del nuevo negocio registrado y su propietario.
   */
  @Post()
  @UseGuards(JwtSesionGuard, PlataformaAdminGuard)
  @ApiOperation({
    summary:
      'Dar de alta una nueva barbería (tenant) en la plataforma con su dueño opcional',
  })
  async crearBarberia(@Body() dto: CrearNegocioPlataformaDto) {
    return this.service.crearBarberia(dto);
  }

  /**
   * Conmuta el estado operativo de una barbería (ACTIVO / INACTIVO).
   *
   * @param id - Identificador numérico único de la barbería.
   * @param dto - Nuevo estado que se desea establecer.
   * @returns Confirmación y datos de la barbería modificada.
   */
  @Patch(':id/estado')
  @UseGuards(JwtSesionGuard, PlataformaAdminGuard)
  @ApiOperation({
    summary: 'Activar o desactivar una barbería en la plataforma',
  })
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CambiarEstadoNegocioDto,
  ) {
    return this.service.cambiarEstado(id, dto);
  }
}

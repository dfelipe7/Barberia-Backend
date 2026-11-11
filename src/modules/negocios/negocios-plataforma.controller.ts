import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { CrearNegocioPlataformaDto } from './dto/crear-negocio-plataforma.dto';
import { CambiarEstadoNegocioDto } from './dto/cambiar-estado-negocio.dto';
import { NegocioPublicoDto } from './dto/negocio-publico.dto';
import { JwtSesionGuard } from '../../auth/guards/jwt-sesion.guard';
import { PlataformaAdminGuard } from './guards/plataforma-admin.guard';
import {
  EstadoNegocio,
  EstadoUsuario,
  RolUsuario,
} from '../../../generated/prisma/enums';

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
  constructor(private readonly prisma: PrismaService) {}

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
    const negocios = await this.prisma.negocio.findMany({
      where: { estado: EstadoNegocio.ACTIVO },
      select: {
        id: true,
        nombre: true,
        slug: true,
        perfil: {
          select: {
            ciudad: true,
            logoBlancoUrl: true,
            bannerUrl: true,
            frasePrincipal: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return negocios.map((negocio) => ({
      id: negocio.id,
      nombre: negocio.nombre,
      slug: negocio.slug,
      ciudad: negocio.perfil?.ciudad ?? null,
      logoBlancoUrl: negocio.perfil?.logoBlancoUrl ?? null,
      bannerUrl: negocio.perfil?.bannerUrl ?? null,
      frasePrincipal: negocio.perfil?.frasePrincipal ?? null,
    }));
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
    const negocios = await this.prisma.negocio.findMany({
      include: {
        perfil: {
          select: {
            direccion: true,
            ciudad: true,
            logoBlancoUrl: true,
            bannerUrl: true,
            frasePrincipal: true,
          },
        },
        _count: {
          select: {
            barberos: true,
            servicios: true,
            reservas: true,
            clientes: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return negocios.map((negocio) => ({
      id: negocio.id,
      nombre: negocio.nombre,
      slug: negocio.slug,
      estado: negocio.estado,
      zonaHoraria: negocio.zonaHoraria,
      creadoEn: negocio.creadoEn,
      perfil: negocio.perfil,
      estadisticas: {
        totalBarberos: negocio._count.barberos,
        totalServicios: negocio._count.servicios,
        totalReservas: negocio._count.reservas,
        totalClientes: negocio._count.clientes,
      },
    }));
  }

  /**
   * Da de alta un nuevo negocio (tenant) en la plataforma vinculando opcionalmente a su administrador fundador.
   *
   * @remarks
   * Realiza una transacción anidada en Prisma que inicializa la sede, crea o vincula al usuario administrador,
   * y le asigna la membresía `superadmin = true` en la nueva barbería.
   *
   * @param dto - Información requerida para la creación del negocio (nombre, slug, zona horaria, administrador).
   * @returns Datos del nuevo negocio registrado y su propietario.
   * @throws {ConflictException} Si el slug ya se encuentra registrado por otra barbería.
   */
  @Post()
  @UseGuards(JwtSesionGuard, PlataformaAdminGuard)
  @ApiOperation({
    summary:
      'Dar de alta una nueva barbería (tenant) en la plataforma con su dueño opcional',
  })
  async crearBarberia(@Body() dto: CrearNegocioPlataformaDto) {
    const slugNormalizado = dto.slug.toLowerCase().trim();

    const existe = await this.prisma.negocio.findUnique({
      where: { slug: slugNormalizado },
    });

    if (existe) {
      throw new ConflictException(
        `Ya existe una barbería con el slug '${slugNormalizado}'.`,
      );
    }

    let usuarioDueno: {
      id: number;
      email: string;
      nombre: string;
      apellido: string;
    } | null = null;

    if (dto.adminEmail) {
      const emailNormalizado = dto.adminEmail.toLowerCase().trim();
      let usuario = await this.prisma.usuario.findUnique({
        where: { email: emailNormalizado },
      });

      usuario ??= await this.prisma.usuario.create({
        data: {
          email: emailNormalizado,
          nombre: dto.adminNombre ? dto.adminNombre.trim() : 'Administrador',
          apellido: dto.adminApellido ? dto.adminApellido.trim() : '',
          rol: RolUsuario.PERSONAL,
          estado: EstadoUsuario.ACTIVO,
        },
      });
      usuarioDueno = usuario;
    }

    // Creación atómica del negocio y membresía de administrador como relación anidada.
    // Al ser escritura anidada en Negocio (modelo global), se ejecuta en una sola sentencia
    // sin violar las restricciones de aislamiento del middleware.
    const negocio = await this.prisma.negocio.create({
      data: {
        nombre: dto.nombre.trim(),
        slug: slugNormalizado,
        zonaHoraria: dto.zonaHoraria || 'America/Bogota',
        estado: EstadoNegocio.ACTIVO,
        perfil: dto.direccion
          ? {
              create: {
                direccion: dto.direccion.trim(),
              },
            }
          : undefined,
        administradores: usuarioDueno
          ? {
              create: {
                usuarioId: usuarioDueno.id,
                superadmin: true,
                estado: EstadoUsuario.ACTIVO,
              },
            }
          : undefined,
      },
      include: {
        perfil: true,
        administradores: true,
      },
    });

    return {
      mensaje: 'Barbería registrada exitosamente en la plataforma.',
      negocio: {
        id: negocio.id,
        nombre: negocio.nombre,
        slug: negocio.slug,
        estado: negocio.estado,
        perfil: negocio.perfil,
        dueno: usuarioDueno
          ? {
              usuarioId: usuarioDueno.id,
              email: usuarioDueno.email,
              nombre: `${usuarioDueno.nombre} ${usuarioDueno.apellido}`.trim(),
              superadmin: true,
            }
          : null,
      },
    };
  }

  /**
   * Conmuta el estado operativo de una barbería (ACTIVO / INACTIVO).
   *
   * @param id - Identificador numérico único de la barbería.
   * @param dto - Nuevo estado que se desea establecer.
   * @returns Confirmación y datos de la barbería modificada.
   * @throws {NotFoundException} Si el negocio no existe en la base de datos.
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
    const negocio = await this.prisma.negocio.findUnique({
      where: { id },
    });

    if (!negocio) {
      throw new NotFoundException('Barbería no encontrada.');
    }

    const actualizado = await this.prisma.negocio.update({
      where: { id },
      data: { estado: dto.estado },
      select: {
        id: true,
        nombre: true,
        slug: true,
        estado: true,
      },
    });

    return {
      mensaje: `La barbería '${actualizado.nombre}' ahora está ${actualizado.estado}.`,
      negocio: actualizado,
    };
  }
}

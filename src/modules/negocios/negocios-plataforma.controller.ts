import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { CrearNegocioPlataformaDto } from './dto/crear-negocio-plataforma.dto';
import { CambiarEstadoNegocioDto } from './dto/cambiar-estado-negocio.dto';
import {
  EstadoNegocio,
  EstadoUsuario,
  RolUsuario,
} from '../../../generated/prisma/enums';

@ApiTags('Plataforma - Directorio de Negocios')
@Controller('plataforma/negocios')
export class NegociosPlataformaController {
  constructor(private readonly prisma: PrismaService) {}

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

  @Post()
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

      if (!usuario) {
        usuario = await this.prisma.usuario.create({
          data: {
            email: emailNormalizado,
            nombre: dto.adminNombre ? dto.adminNombre.trim() : 'Administrador',
            apellido: dto.adminApellido ? dto.adminApellido.trim() : '',
            rol: RolUsuario.PERSONAL,
            estado: EstadoUsuario.ACTIVO,
          },
        });
      }
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

  @Patch(':id/estado')
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

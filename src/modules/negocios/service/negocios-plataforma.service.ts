/**
 * Trazabilidad:
 * - REQ: Refactorización Arquitectónica Clean Controller
 * - Modelo ejecutor: gemini-2.5-pro
 * - Propósito: encapsular la lógica de negocio, consultas Prisma y transacciones de la plataforma/tenants.
 * - Responsabilidad: orquestar el ciclo de vida de los tenants (onboarding, directorio público, métricas y cambio de estado).
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CrearNegocioPlataformaDto } from '../dto/crear-negocio-plataforma.dto';
import { CambiarEstadoNegocioDto } from '../dto/cambiar-estado-negocio.dto';
import {
  EstadoNegocio,
  EstadoUsuario,
  RolUsuario,
} from '../../../../generated/prisma/enums';

@Injectable()
export class NegociosPlataformaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene la lista de barberías activas para desplegar en el directorio público del SaaS.
   */
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
   * Lista todas las barberías registradas en la plataforma con estadísticas agregadas.
   */
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
   */
  async crearBarberia(dto: CrearNegocioPlataformaDto) {
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
   */
  async cambiarEstado(id: number, dto: CambiarEstadoNegocioDto) {
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

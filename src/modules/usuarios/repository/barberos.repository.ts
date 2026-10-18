import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EstadoUsuario } from '../../../../generated/prisma/enums';

@Injectable()
export class BarberosRepository {
  constructor(private readonly prisma: PrismaService) {}

  async crearBarberoNuevo(data: {
    usuarioId: number;
    telefono: string;
    porcentajeComision: number;
    fotoUrl?: string;
  }) {
    return this.prisma.barbero.create({
      data,
    });
  }

  async crearPerfilBarbero(data: {
    usuarioId: number;
    telefono: string;
    porcentajeComision: number;
    fotoUrl?: string;
  }) {
    return this.crearBarberoNuevo(data);
  }

  async actualizarComision(usuarioId: number, porcentajeComision: number) {
    return this.prisma.barbero.update({
      where: {
        usuarioId,
      },
      data: {
        porcentajeComision,
      },
    });
  }

  async actualizarPerfilBarbero(
    usuarioId: number,
    data: {
      telefono?: string;
      porcentajeComision?: number;
      fotoUrl?: string | null;
    },
  ) {
    return this.prisma.barbero.update({
      where: {
        usuarioId,
      },
      data,
    });
  }

  async obtenerBarberoPorUsuarioId(usuarioId: number) {
    return this.prisma.barbero.findUnique({
      where: {
        usuarioId,
      },
    });
  }

  /**
   * Obtiene un barbero por su `Barbero.id`, solo si tanto el perfil de barbero
   * como la cuenta de usuario están ACTIVOS. Se usa para validar la existencia
   * del barbero en la consulta pública de disponibilidad.
   */
  async obtenerBarberoActivoPorId(barberoId: number) {
    return this.prisma.barbero.findFirst({
      where: {
        id: barberoId,
        estado: EstadoUsuario.ACTIVO,
        usuario: {
          estado: EstadoUsuario.ACTIVO,
        },
      },
    });
  }

  async obtenerBarberoPorId(id: number) {
    return this.prisma.barbero.findUnique({
      where: { id },
      include: {
        usuario: true,
      },
    });
  }

  async obtenerBarberosCatalogo(filtro?: { nombre?: string }) {
    const whereCondition: any = {
      estado: EstadoUsuario.ACTIVO,
      usuario: {
        estado: EstadoUsuario.ACTIVO,
      },
    };

    if (filtro?.nombre) {
      whereCondition.usuario.OR = [
        { nombre: { contains: filtro.nombre } },
        { apellido: { contains: filtro.nombre } },
      ];
    }

    return this.prisma.barbero.findMany({
      where: whereCondition,
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
          },
        },
      },
    });
  }

  async obtenerBarberosGestion(filtro?: {
    nombre?: string;
    estado?: EstadoUsuario;
  }) {
    const whereCondition: any = {};

    if (filtro?.estado) {
      if (filtro.estado === EstadoUsuario.ACTIVO) {
        whereCondition.estado = EstadoUsuario.ACTIVO;
        whereCondition.usuario = {
          estado: EstadoUsuario.ACTIVO,
        };
      } else {
        whereCondition.OR = [
          { estado: EstadoUsuario.INACTIVO },
          { usuario: { estado: EstadoUsuario.INACTIVO } },
        ];
      }
    }

    if (filtro?.nombre) {
      if (!whereCondition.usuario) whereCondition.usuario = {};
      whereCondition.usuario.OR = [
        { nombre: { contains: filtro.nombre } },
        { apellido: { contains: filtro.nombre } },
        { email: { contains: filtro.nombre } },
      ];
    }

    return this.prisma.barbero.findMany({
      where: whereCondition,
      include: {
        usuario: {
          include: {
            administrador: true,
          },
        },
      },
    });
  }

  async actualizarEstadoBarbero(usuarioId: number, estado: EstadoUsuario) {
    return this.prisma.barbero.update({
      where: {
        usuarioId,
      },
      data: {
        estado,
      },
    });
  }
}

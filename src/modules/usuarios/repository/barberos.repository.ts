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
  }) {
    return this.prisma.barbero.create({
      data,
    });
  }

  async crearPerfilBarbero(data: {
    usuarioId: number;
    telefono: string;
    porcentajeComision: number;
  }) {
    return this.prisma.barbero.create({
      data,
    });
  }

  async actualizarComision(
    usuarioId: number,
    porcentajeComision: number,
  ) {
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
    },
  ) {
    return this.prisma.barbero.update({
      where: {
        usuarioId,
      },
      data,
    });
  }

  async obtenerBarberosCatalogo() {
    return this.prisma.barbero.findMany({
      where: {
        estado: 'ACTIVO',
        usuario: {
          estado: 'ACTIVO',
        },
      },
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

  async obtenerBarberosGestion() {
    return this.prisma.barbero.findMany({
      include: {
        usuario: {
          include: {
            administrador: true,
          },
        },
      },
    });
  }

  async actualizarEstadoBarbero(
    usuarioId: number,
    estado: EstadoUsuario,
  ) {
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

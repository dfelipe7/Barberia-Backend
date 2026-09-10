import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AdministradoresRepository {
  constructor(private readonly prisma: PrismaService) {}

  async crearAdministrador(data: {
    usuarioId: number;
  }) {
    return this.prisma.administrador.create({
      data,
    });
  }

  async obtenerAdministradores() {
    return this.prisma.administrador.findMany({
      where: {
        usuario: {
          rol: {
            not: 'SUPERADMIN',
          },
        },
      },
      include: {
        usuario: {
          include: {
            barbero: true,
          },
        },
      },
    });
  }

  async actualizarEstadoAdministrador(usuarioId: number, estado: 'ACTIVO' | 'INACTIVO') {
    return this.prisma.administrador.update({
      where: {
        usuarioId,
      },
      data: {
        estado,
      },
    });
  }

  async obtenerAdministradorPorUsuarioId(usuarioId: number) {
    return this.prisma.administrador.findUnique({
      where: {
        usuarioId,
      },
    });
  }
}

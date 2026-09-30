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

  async obtenerAdministradores(filtro?: { nombre?: string; estado?: 'ACTIVO' | 'INACTIVO' }) {
    const whereCondition: any = {
      usuario: {
        rol: {
          not: 'SUPERADMIN',
        },
      },
    };

    if (filtro?.estado) {
      if (filtro.estado === 'ACTIVO') {
        whereCondition.estado = 'ACTIVO';
        whereCondition.usuario.estado = 'ACTIVO';
      } else {
        whereCondition.OR = [
          { estado: 'INACTIVO' },
          { usuario: { estado: 'INACTIVO' } },
        ];
      }
    }

    if (filtro?.nombre) {
      whereCondition.usuario = {
        ...(whereCondition.usuario || {}),
        OR: [
          { nombre: { contains: filtro.nombre } },
          { apellido: { contains: filtro.nombre } },
          { email: { contains: filtro.nombre } },
        ],
      };
    }

    return this.prisma.administrador.findMany({
      where: whereCondition,
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

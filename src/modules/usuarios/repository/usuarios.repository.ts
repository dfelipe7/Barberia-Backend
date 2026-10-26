import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EstadoUsuario, RolUsuario } from '../../../../generated/prisma/enums';

@Injectable()
export class UsuariosRepository {
  constructor(private readonly prisma: PrismaService) {}

  async crearUsuario(data: {
    googleId?: string;
    email: string;
    nombre: string;
    apellido: string;
    rol: RolUsuario;
  }) {
    return this.prisma.usuario.create({
      data,
    });
  }

  async obtenerUsuarioPorId(usuarioId: number) {
    return this.prisma.usuario.findUnique({
      where: {
        id: usuarioId,
      },
      include: {
        administradores: true,
        barberos: true,
      },
    });
  }

  async obtenerUsuarioPorGoogleId(googleId: string) {
    return this.prisma.usuario.findUnique({
      where: {
        googleId,
      },
      include: {
        administradores: true,
        barberos: true,
      },
    });
  }

  async obtenerUsuarioPorEmail(email: string) {
    return this.prisma.usuario.findUnique({
      where: {
        email,
      },
      include: {
        administradores: true,
        barberos: true,
      },
    });
  }

  async actualizarUsuario(
    usuarioId: number,
    data: {
      nombre?: string;
      apellido?: string;
      email?: string;
    },
  ) {
    return this.prisma.usuario.update({
      where: {
        id: usuarioId,
      },
      data,
    });
  }

  async actualizarEstadoUsuario(usuarioId: number, estado: EstadoUsuario) {
    return this.prisma.usuario.update({
      where: {
        id: usuarioId,
      },
      data: {
        estado,
      },
    });
  }

  async actualizarRol(usuarioId: number, rol: RolUsuario) {
    return this.prisma.usuario.update({
      where: {
        id: usuarioId,
      },
      data: {
        rol,
      },
    });
  }
}

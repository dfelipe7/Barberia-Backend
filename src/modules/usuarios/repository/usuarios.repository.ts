import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EstadoUsuario } from '../../../../generated/prisma/enums';

@Injectable()
export class UsuariosRepository {
  constructor(private readonly prisma: PrismaService) {}

  async crearUsuario(data: {
    keycloakId: string;
    email: string;
    nombre: string;
    apellido: string;
    rol: 'SUPERADMIN' | 'ADMINISTRADOR' | 'BARBERO';
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
        administrador: true,
        barbero: true,
      },
    });
  }

  async obtenerUsuarioPorKeycloakId(keycloakId: string) {
    return this.prisma.usuario.findUnique({
      where: {
        keycloakId,
      },
      include: {
        administrador: true,
        barbero: true,
      },
    });
  }

  async obtenerUsuarioPorEmail(email: string) {
    return this.prisma.usuario.findUnique({
      where: {
        email,
      },
      include: {
        administrador: true,
        barbero: true,
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

  async actualizarEstadoUsuario(
    usuarioId: number,
    estado: EstadoUsuario,
  ) {
    return this.prisma.usuario.update({
      where: {
        id: usuarioId,
      },
      data: {
        estado,
      },
    });
  }
}
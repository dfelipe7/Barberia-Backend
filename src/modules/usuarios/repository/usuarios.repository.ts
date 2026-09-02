import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
@Injectable()
export class UsuariosRepository {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

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

  async crearAdministrador(data: {
    usuarioId: number;
  }) {
    return this.prisma.administrador.create({
      data,
    });
  }

  async crearBarberoNuevo(data: {
    usuarioId: number;
    telefono: string;
    porcentajeComision: number;
  }) {
    return this.prisma.barbero.create({
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

  async crearPerfilBarbero(data: {
    usuarioId: number;
    telefono: string;
    porcentajeComision: number;
  }) {
    return this.prisma.barbero.create({
      data,
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

async obtenerBarberosCatalogo() {
  return this.prisma.barbero.findMany({
    where: {
      estado: 'ACTIVO',
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

async obtenerAdministradores() {
  return this.prisma.administrador.findMany({
    include: {
      usuario: true,
    },
  });
}

async obtenerBarberosGestion() {
  return this.prisma.barbero.findMany({
    include: {
      usuario: true,
    },
  });
}


}
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
      include: {
        usuario: true,
      },
    });
  }
}

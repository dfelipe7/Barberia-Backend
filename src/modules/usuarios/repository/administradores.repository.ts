import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';

/**
 * Condición de búsqueda de administradores.
 *
 * Se declara como `type` (y no como `interface`) para que sea asignable a
 * `Record<string, unknown>`, que es lo que exige el filtro de aislamiento.
 */
type CondicionAdministradores = {
  estado?: 'ACTIVO' | 'INACTIVO';
  usuario?: {
    estado?: 'ACTIVO' | 'INACTIVO';
    OR?: Array<Record<string, unknown>>;
  };
  OR?: Array<Record<string, unknown>>;
};

@Injectable()
export class AdministradoresRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  async crearAdministrador(data: { usuarioId: number }) {
    return this.prisma.administrador.create({
      data: { ...data, negocioId: this.aislamiento.negocioIdRequerido() },
    });
  }

  async obtenerAdministradores(filtro?: {
    nombre?: string;
    estado?: 'ACTIVO' | 'INACTIVO';
  }) {
    // El listado es el de LOS ADMINISTRADORES DE ESTE NEGOCIO: el filtro de
    // negocio lo aporta `filtroLectura`. Ya no se excluye a nadie por su
    // `Usuario.rol` global: el carácter SUPERADMIN es de la membresía
    // (`Administrador.superadmin`) y un superadmin de esta barbería es, igual
    // que el resto, un administrador de ella.
    const whereCondition: CondicionAdministradores = {};

    if (filtro?.estado) {
      if (filtro.estado === 'ACTIVO') {
        whereCondition.estado = 'ACTIVO';
        whereCondition.usuario = {
          ...whereCondition.usuario,
          estado: 'ACTIVO',
        };
      } else {
        whereCondition.OR = [
          { estado: 'INACTIVO' },
          { usuario: { estado: 'INACTIVO' } },
        ];
      }
    }

    if (filtro?.nombre) {
      whereCondition.usuario = {
        ...whereCondition.usuario,
        OR: [
          { nombre: { contains: filtro.nombre } },
          { apellido: { contains: filtro.nombre } },
          { email: { contains: filtro.nombre } },
        ],
      };
    }

    return this.prisma.administrador.findMany({
      where: this.aislamiento.filtroLectura(whereCondition),
      include: {
        usuario: {
          include: {
            barberos: true,
          },
        },
      },
    });
  }

  /**
   * Clave única del perfil de administrador de una persona en el negocio ACTIVO.
   *
   * `usuarioId` ya no es único global: la misma persona puede ser
   * administradora de varias barberías.
   */
  private dondePerfilEnNegocio(usuarioId: number) {
    return {
      negocioId_usuarioId: {
        negocioId: this.aislamiento.negocioIdRequerido(),
        usuarioId,
      },
    };
  }

  async actualizarEstadoAdministrador(
    usuarioId: number,
    estado: 'ACTIVO' | 'INACTIVO',
  ) {
    return this.prisma.administrador.update({
      where: this.dondePerfilEnNegocio(usuarioId),
      data: {
        estado,
      },
    });
  }

  async obtenerAdministradorPorUsuarioId(usuarioId: number) {
    return this.prisma.administrador.findFirst({
      where: this.aislamiento.filtroLectura({ usuarioId }),
    });
  }
}

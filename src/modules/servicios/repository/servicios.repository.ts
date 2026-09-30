import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EstadoServicio, EstadoUsuario } from '../../../../generated/prisma/enums';

/**
 * Fragmento reutilizable para incluir únicamente los barberos ACTIVOS asignados al servicio,
 * junto con los datos personales de su usuario (nombre, apellido, email).
 */
const INCLUDE_BARBEROS = {
    barberos: {
        where: {
            barbero: {
                estado: EstadoUsuario.ACTIVO,
                usuario: {
                    estado: EstadoUsuario.ACTIVO,
                },
            },
        },
        include: {
            barbero: {
                include: {
                    usuario: {
                        select: {
                            id: true,
                            nombre: true,
                            apellido: true,
                            email: true,
                        },
                    },
                },
            },
        },
    },
};

@Injectable()
export class ServiciosRepository {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    /**
     * Consulta los barberos que existen y se encuentran en estado ACTIVO (tanto el rol como la cuenta global).
     * Utilizado para validar que no se asocien barberos inactivos o inexistentes a un servicio.
     */
    async obtenerBarberosActivosPorIds(ids: number[]) {
        return this.prisma.barbero.findMany({
            where: {
                usuarioId: { in: ids },
                estado: EstadoUsuario.ACTIVO,
                usuario: {
                    estado: EstadoUsuario.ACTIVO,
                },
            },
            select: {
                usuarioId: true,
            },
        });
    }

    /**
     * Busca un servicio por su nombre exacto (utilizado para evitar duplicados).
     */
    async obtenerServicioPorNombre(nombre: string) {
        return this.prisma.servicio.findUnique({
            where: { nombre },
        });
    }

    /**
     * Obtiene el detalle de un servicio por su ID, incluyendo sus barberos.
     */
    async obtenerServicioPorId(id: number) {
        return this.prisma.servicio.findUnique({
            where: { id },
            include: INCLUDE_BARBEROS,
        });
    }

    /**
     * Catálogo público: Lista únicamente los servicios que están ACTIVOS con opción de filtro por nombre.
     * Ordenados alfabéticamente para facilitar la selección al cliente en la reserva.
     */
    async listarServiciosCatalogo(filtro?: { nombre?: string }) {
        const whereCondition: any = {
            estado: EstadoServicio.ACTIVO,
        };

        if (filtro?.nombre) {
            whereCondition.OR = [
                { nombre: { contains: filtro.nombre } },
                { descripcion: { contains: filtro.nombre } },
            ];
        }

        return this.prisma.servicio.findMany({
            where: whereCondition,
            include: INCLUDE_BARBEROS,
            orderBy: {
                nombre: 'asc',
            },
        });
    }

    /**
     * Vista de gestión administrativa: Lista TODOS los servicios (activos e inactivos) con soporte de filtros.
     * Permite al Superadmin y Administrador ver el catálogo completo para editar o reactivar.
     */
    async listarServiciosGestion(filtro?: { nombre?: string; estado?: EstadoServicio }) {
        const whereCondition: any = {};

        if (filtro?.estado) {
            whereCondition.estado = filtro.estado;
        }

        if (filtro?.nombre) {
            whereCondition.OR = [
                { nombre: { contains: filtro.nombre } },
                { descripcion: { contains: filtro.nombre } },
            ];
        }

        return this.prisma.servicio.findMany({
            where: whereCondition,
            include: INCLUDE_BARBEROS,
            orderBy: {
                id: 'desc',
            },
        });
    }

    /**
     * Consulta inversa: Retorna los servicios ACTIVOS asociados a un barbero específico.
     * Utilizado cuando el cliente escoge primero a su barbero favorito.
     */
    async listarServiciosPorBarbero(barberoId: number) {
        return this.prisma.servicio.findMany({
            where: {
                estado: EstadoServicio.ACTIVO,
                barberos: {
                    some: {
                        barbero: {
                            usuarioId: barberoId,
                        },
                    },
                },
            },
            include: INCLUDE_BARBEROS,
            orderBy: {
                nombre: 'asc',
            },
        });
    }

    /**
     * Crea un nuevo servicio y, si se especificaron barberos,
     * los vincula de forma atómica en la tabla intermedia BarberoServicio usando el usuarioId.
     */
    async crearServicio(data: {
        nombre: string;
        descripcion?: string;
        precio: number;
        duracionMinutos: number;
        fotoUrl?: string;
        barberoIds?: number[];
    }) {
        return this.prisma.servicio.create({
            data: {
                nombre: data.nombre,
                descripcion: data.descripcion,
                precio: data.precio,
                duracionMinutos: data.duracionMinutos,
                fotoUrl: data.fotoUrl,
                barberos: data.barberoIds && data.barberoIds.length > 0
                    ? {
                        create: data.barberoIds.map((usuarioId) => ({
                            barbero: { connect: { usuarioId } },
                        })),
                    }
                    : undefined,
            },
            include: INCLUDE_BARBEROS,
        });
    }

    /**
     * Actualiza los datos de un servicio. Si se provee la lista de barberoIds,
     * sincroniza las asignaciones en la tabla intermedia eliminando las anteriores
     * e insertando las nuevas en una sola transacción segura usando usuarioId.
     */
    async actualizarServicio(
        id: number,
        data: {
            nombre?: string;
            descripcion?: string;
            precio?: number;
            duracionMinutos?: number;
            fotoUrl?: string | null;
            barberoIds?: number[];
        },
    ) {
        return this.prisma.servicio.update({
            where: { id },
            data: {
                nombre: data.nombre,
                descripcion: data.descripcion,
                precio: data.precio,
                duracionMinutos: data.duracionMinutos,
                fotoUrl: data.fotoUrl,
                barberos: data.barberoIds !== undefined
                    ? {
                        deleteMany: {},
                        create: data.barberoIds.map((usuarioId) => ({
                            barbero: { connect: { usuarioId } },
                        })),
                    }
                    : undefined,
            },
            include: INCLUDE_BARBEROS,
        });
    }

    /**
     * Cambia el estado (ACTIVO / INACTIVO) de un servicio (borrado lógico).
     */
    async cambiarEstado(id: number, estado: EstadoServicio) {
        return this.prisma.servicio.update({
            where: { id },
            data: { estado },
            include: INCLUDE_BARBEROS,
        });
    }
}

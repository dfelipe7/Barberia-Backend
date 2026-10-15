import {
    Injectable,
    ConflictException,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { CrearServicioDto } from '../dto/dto-peticion/crear-servicio.dto';
import { ActualizarServicioDto } from '../dto/dto-peticion/actualizar-servicio.dto';
import { CambiarEstadoServicioDto } from '../dto/dto-peticion/cambiar-estado-servicio.dto';
import { FiltroServiciosDto } from '../dto/dto-peticion/filtro-servicios.dto';
import { ServicioResponseDto } from '../dto/dto-respuesta/servicio-response.dto';
import { BarberoPorServicioDto } from '../dto/dto-respuesta/barbero-por-servicio.dto';
import { ServiciosRepository } from '../repository/servicios.repository';

@Injectable()
export class ServiciosService {
    constructor(
        private readonly serviciosRepository: ServiciosRepository,
    ) {}

    /**
     * Valida que todos los IDs de barberos proporcionados pertenezcan a barberos
     * existentes en la base de datos y que estén en estado ACTIVO.
     */
    private async validarBarberosActivos(barberoIds?: number[]) {
        if (!barberoIds || barberoIds.length === 0) {
            return;
        }

        // Eliminar posibles duplicados enviados en el array
        const idsUnicos = [...new Set(barberoIds)];
        const barberosActivos = await this.serviciosRepository.obtenerBarberosActivosPorIds(idsUnicos);

        if (barberosActivos.length !== idsUnicos.length) {
            throw new BadRequestException(
                'Uno o más barberos seleccionados no existen o no se encuentran en estado ACTIVO',
            );
        }
    }

    /**
     * Catálogo público: Retorna únicamente los servicios con estado ACTIVO con soporte de búsqueda.
     * Es consumido por los clientes para el flujo de reservas y vista pública.
     */
    async obtenerServiciosCatalogo(filtro?: FiltroServiciosDto): Promise<ServicioResponseDto[]> {
        const servicios = await this.serviciosRepository.listarServiciosCatalogo(filtro);
        return servicios.map((s) => this.mapearServicio(s));
    }

    /**
     * Panel administrativo: Retorna todos los servicios (activos e inactivos) con soporte de filtros.
     * Exclusivo para Superadmin y Administradores en la gestión del catálogo.
     */
    async obtenerServiciosGestion(filtro?: FiltroServiciosDto): Promise<ServicioResponseDto[]> {
        const servicios = await this.serviciosRepository.listarServiciosGestion(filtro);
        return servicios.map((s) => this.mapearServicio(s));
    }

    /**
     * Consulta inversa: Retorna los servicios activos que realiza un barbero específico.
     */
    async obtenerServiciosPorBarbero(barberoId: number): Promise<ServicioResponseDto[]> {
        const servicios = await this.serviciosRepository.listarServiciosPorBarbero(barberoId);
        return servicios.map((s) => this.mapearServicio(s));
    }

    /**
     * HE-04-HU-02: Retorna los barberos ACTIVOS que tienen habilitado un
     * servicio ACTIVO. Devuelve una lista vacía (no un error) cuando el servicio
     * existe pero ningún barbero lo presta, para que el cliente muestre el
     * mensaje "No hay barberos disponibles para este servicio".
     *
     * Arroja 404 si el servicio no existe o está inactivo: no se enumeran
     * barberos de un servicio que no está disponible para reservar.
     */
    async obtenerBarberosPorServicio(servicioId: number): Promise<BarberoPorServicioDto[]> {
        const servicio = await this.serviciosRepository.obtenerServicioActivoPorId(servicioId);
        if (!servicio) {
            throw new NotFoundException(
                `El servicio con ID ${servicioId} no existe o no está activo`,
            );
        }

        const barberos =
            await this.serviciosRepository.listarBarberosActivosPorServicio(servicioId);

        return barberos
            .map((barbero) => ({
                id: barbero.id,
                nombre: barbero.usuario.nombre,
                apellido: barbero.usuario.apellido,
                fotoUrl: barbero.fotoUrl,
            }))
            .sort((a, b) =>
                `${a.nombre} ${a.apellido}`.localeCompare(`${b.nombre} ${b.apellido}`),
            );
    }

    /**
     * Obtiene el detalle de un servicio por su identificador único.
     * Arroja 404 si el servicio no existe en la base de datos.
     */
    async obtenerServicioPorId(id: number): Promise<ServicioResponseDto> {
        const servicio = await this.serviciosRepository.obtenerServicioPorId(id);
        if (!servicio) {
            throw new NotFoundException(`El servicio con ID ${id} no existe`);
        }
        return this.mapearServicio(servicio);
    }

    /**
     * Registra un nuevo servicio en el sistema.
     * Valida que no exista otro servicio con el mismo nombre y que los barberos asociados estén ACTIVOS.
     */
    async crearServicio(dto: CrearServicioDto) {
        const servicioExistente = await this.serviciosRepository.obtenerServicioPorNombre(dto.nombre);
        if (servicioExistente) {
            throw new ConflictException('Ya existe un servicio con este nombre');
        }

        // Seguridad: Validar que todos los barberos a asociar existan y estén activos
        await this.validarBarberosActivos(dto.barberoIds);

        return this.serviciosRepository.crearServicio({
            nombre: dto.nombre,
            descripcion: dto.descripcion,
            precio: dto.precio,
            duracionMinutos: dto.duracionMinutos,
            fotoUrl: dto.fotoUrl,
            barberoIds: dto.barberoIds,
        });
    }

    /**
     * Actualiza la información de un servicio y/o sus barberos asociados.
     * Valida la existencia del servicio, evita duplicados de nombre y valida que los barberos estén ACTIVOS.
     */
    async actualizarServicio(id: number, dto: ActualizarServicioDto) {
        const servicioActual = await this.obtenerServicioPorId(id);

        if (dto.nombre && dto.nombre !== servicioActual.nombre) {
            const servicioConMismoNombre = await this.serviciosRepository.obtenerServicioPorNombre(dto.nombre);
            if (servicioConMismoNombre && servicioConMismoNombre.id !== id) {
                throw new ConflictException('Ya existe otro servicio con este nombre');
            }
        }

        // Seguridad: Si se actualizan barberos, validar que todos existan y estén activos
        if (dto.barberoIds !== undefined) {
            await this.validarBarberosActivos(dto.barberoIds);
        }

        return this.serviciosRepository.actualizarServicio(id, {
            nombre: dto.nombre,
            descripcion: dto.descripcion,
            precio: dto.precio,
            duracionMinutos: dto.duracionMinutos,
            fotoUrl: dto.fotoUrl,
            barberoIds: dto.barberoIds,
        });
    }

    /**
     * Realiza un borrado lógico (soft delete) activando o desactivando un servicio.
     * Permite retirar un servicio del catálogo público sin romper citas pasadas.
     */
    async cambiarEstadoServicio(id: number, dto: CambiarEstadoServicioDto) {
        await this.obtenerServicioPorId(id);
        return this.serviciosRepository.cambiarEstado(id, dto.estado);
    }

    /**
     * Sube o actualiza la foto de un servicio.
     * Si ya tenía una foto previa almacenada en /uploads/servicios/, elimina el archivo anterior del disco.
     */
    async subirFotoServicio(id: number, archivo: Express.Multer.File) {
        const servicio = await this.obtenerServicioPorId(id);

        if (servicio.fotoUrl?.startsWith('/uploads/servicios/')) {
            const rutaAnterior = join(process.cwd(), servicio.fotoUrl);
            if (fs.existsSync(rutaAnterior)) {
                try {
                    fs.unlinkSync(rutaAnterior);
                } catch (e) {
                    console.warn('No se pudo eliminar la foto anterior del servicio:', e);
                }
            }
        }

        const nuevaFotoUrl = `/uploads/servicios/${archivo.filename}`;
        const servicioActualizado = await this.serviciosRepository.actualizarServicio(id, {
            fotoUrl: nuevaFotoUrl,
        });

        return {
            mensaje: 'Foto del servicio actualizada correctamente',
            fotoUrl: nuevaFotoUrl,
            servicio: servicioActualizado,
        };
    }

    /**
     * Elimina la foto de un servicio tanto de la base de datos como del disco físico.
     */
    async eliminarFotoServicio(id: number) {
        const servicio = await this.obtenerServicioPorId(id);

        if (servicio.fotoUrl?.startsWith('/uploads/servicios/')) {
            const ruta = join(process.cwd(), servicio.fotoUrl);
            if (fs.existsSync(ruta)) {
                try {
                    fs.unlinkSync(ruta);
                } catch (e) {
                    console.warn('No se pudo eliminar el archivo físico de la foto del servicio:', e);
                }
            }
        }

        await this.serviciosRepository.actualizarServicio(id, {
            fotoUrl: null,
        });

        return {
            mensaje: 'Foto del servicio eliminada correctamente',
            fotoUrl: null,
        };
    }

    /**
     * Transforma la estructura anidada de Prisma a un formato limpio para el Frontend.
     * Aplana: BarberoServicio[] → Barbero → Usuario → { id, nombre, apellido, fotoUrl }
     */
    private mapearServicio(servicio: any): ServicioResponseDto {
        return {
            id: servicio.id,
            nombre: servicio.nombre,
            descripcion: servicio.descripcion,
            precio: Number(servicio.precio),
            duracionMinutos: servicio.duracionMinutos,
            fotoUrl: servicio.fotoUrl,
            estado: servicio.estado,
            barberos: (servicio.barberos || []).map((bs: any) => ({
                id: bs.barbero.usuario.id,
                nombre: bs.barbero.usuario.nombre,
                apellido: bs.barbero.usuario.apellido,
                fotoUrl: bs.barbero.fotoUrl,
            })),
        };
    }
}

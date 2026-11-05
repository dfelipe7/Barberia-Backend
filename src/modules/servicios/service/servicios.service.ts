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
  constructor(private readonly serviciosRepository: ServiciosRepository) {}

  /**
   * Valida y normaliza la lista de identificadores de barberos asignados a un servicio.
   *
   * @remarks
   * Integridad y Aislamiento Multitenant:
   * Los clientes de la API pueden remitir identificadores que correspondan tanto a `Barbero.id`
   * como a `Usuario.id`. Este método resuelve siempre el `Barbero.id` real perteneciente
   * exclusivamente a la sede actual y confirma su estado `ACTIVO`. Si algún barbero pertenece
   * a otra sede o está inactivo, la operación se rechaza de inmediato (fail-closed).
   *
   * @param barberoIds - Array de identificadores enviados por el cliente.
   * @returns Array de `Barbero.id` normalizados y libres de duplicados.
   * @throws {BadRequestException} Si alguno de los barberos no existe o está inactivo en la sede.
   */
  private async normalizarYValidarBarberosActivos(
    barberoIds?: number[],
  ): Promise<number[] | undefined> {
    if (!barberoIds || barberoIds.length === 0) {
      return barberoIds;
    }

    // Eliminar posibles duplicados enviados en el array
    const idsUnicos = [...new Set(barberoIds)];
    const barberosActivos =
      await this.serviciosRepository.obtenerBarberosActivosPorIds(idsUnicos);

    // Mapear cada ID recibido a su Barbero.id real en esta barbería
    const barberoIdsResueltos = idsUnicos.map((idEnviado) => {
      const match = barberosActivos.find(
        (b) => b.id === idEnviado || b.usuarioId === idEnviado,
      );
      return match ? match.id : null;
    });

    if (barberoIdsResueltos.includes(null)) {
      throw new BadRequestException(
        'Uno o más barberos seleccionados no existen o no se encuentran en estado ACTIVO',
      );
    }

    // Retorna los Barbero.id únicos y normalizados
    return [...new Set(barberoIdsResueltos as number[])];
  }

  /**
   * Retorna el catálogo público de servicios disponibles para reserva por los clientes.
   *
   * @remarks
   * Regla de Negocio B2C:
   * Solo expone servicios con estado `ACTIVO`. Si un servicio fue dado de baja lógicamente,
   * se oculta del catálogo para evitar nuevos agendamientos sin alterar citas históricas.
   *
   * @param filtro - Criterios opcionales de búsqueda por texto o categoría.
   * @returns Lista de DTOs de servicios activos formateados para consumo público.
   */
  async obtenerServiciosCatalogo(
    filtro?: FiltroServiciosDto,
  ): Promise<ServicioResponseDto[]> {
    const servicios =
      await this.serviciosRepository.listarServiciosCatalogo(filtro);
    return servicios.map((s) => this.mapearServicio(s));
  }

  /**
   * Retorna el inventario completo de servicios para el panel administrativo de la sede.
   *
   * @remarks
   * Gestión B2B y Auditoría:
   * Incluye tanto servicios activos como inactivos para permitir su reactivación,
   * ajuste de precios, modificación de duración y reasignación de personal.
   *
   * @param filtro - Filtros administrativos de estado y término de búsqueda.
   * @returns Lista de todos los servicios registrados para la barbería.
   */
  async obtenerServiciosGestion(
    filtro?: FiltroServiciosDto,
  ): Promise<ServicioResponseDto[]> {
    const servicios =
      await this.serviciosRepository.listarServiciosGestion(filtro);
    return servicios.map((s) => this.mapearServicio(s));
  }

  /**
   * Retorna los servicios activos asignados a un barbero en particular.
   *
   * @remarks
   * Anti-Enumeración Multitenant:
   * Valida previamente que el barbero pertenezca a la sede activa. Si pertenece a otro negocio,
   * responde 404 con mensaje idéntico al de barbero inexistente para prevenir fuga de datos.
   *
   * @param barberoId - Identificador del barbero (`Barbero.id`).
   * @returns Lista de servicios que dicho profesional está habilitado para prestar.
   * @throws {NotFoundException} Si el barbero no existe o no pertenece a este negocio.
   */
  async obtenerServiciosPorBarbero(
    barberoId: number,
  ): Promise<ServicioResponseDto[]> {
    const barbero =
      await this.serviciosRepository.obtenerBarberoActivoEnNegocio(barberoId);

    if (!barbero) {
      throw new NotFoundException(
        `El barbero ${barberoId} no existe o no está activo`,
      );
    }

    const servicios =
      await this.serviciosRepository.listarServiciosPorBarbero(barberoId);
    return servicios.map((s) => this.mapearServicio(s));
  }

  /**
   * Consulta los barberos activos capacitados para realizar un servicio determinado.
   *
   * @remarks
   * Experiencia de Usuario y Contrato API (HE-04-HU-02):
   * Si el servicio existe pero actualmente no tiene profesionales asignados, devuelve
   * un array vacío `[]` (código HTTP 200) permitiendo a la UI mostrar un mensaje amigable.
   * Si el servicio está inactivo o no existe en la sede, responde 404 para evitar reservas inválidas.
   *
   * @param servicioId - ID del servicio consultado.
   * @returns Lista de barberos activos ordenados alfabéticamente por nombre y apellido.
   * @throws {NotFoundException} Si el servicio no existe o no está activo en la sede.
   */
  async obtenerBarberosPorServicio(
    servicioId: number,
  ): Promise<BarberoPorServicioDto[]> {
    const servicio =
      await this.serviciosRepository.obtenerServicioActivoPorId(servicioId);
    if (!servicio) {
      throw new NotFoundException(
        `El servicio con ID ${servicioId} no existe o no está activo`,
      );
    }

    const barberos =
      await this.serviciosRepository.listarBarberosActivosPorServicio(
        servicioId,
      );

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
   * Registra un nuevo servicio en el catálogo de la sede activa.
   *
   * @remarks
   * Reglas de Integridad y Unicidad:
   * - El nombre del servicio no puede colisionar con otro servicio existente en la misma sede.
   * - Los barberos asociados son validados y normalizados contra la membresía de la sede.
   *
   * @param dto - Datos del servicio a crear (nombre, precio, duración, foto, barberos).
   * @returns Registro del servicio persistido en base de datos.
   * @throws {ConflictException} Si ya existe un servicio con el mismo nombre en la sede.
   * @throws {BadRequestException} Si los IDs de barberos son inválidos o inactivos.
   */
  async crearServicio(dto: CrearServicioDto) {
    const servicioExistente =
      await this.serviciosRepository.obtenerServicioPorNombre(dto.nombre);
    if (servicioExistente) {
      throw new ConflictException('Ya existe un servicio con este nombre');
    }

    // Seguridad Multitenant: Validar que todos los barberos a asociar existan y estén activos,
    // y normalizar los IDs al Barbero.id real de la barbería.
    const barberoIdsNormalizados = await this.normalizarYValidarBarberosActivos(
      dto.barberoIds,
    );

    return this.serviciosRepository.crearServicio({
      nombre: dto.nombre,
      descripcion: dto.descripcion,
      precio: dto.precio,
      duracionMinutos: dto.duracionMinutos,
      fotoUrl: dto.fotoUrl,
      barberoIds: barberoIdsNormalizados,
    });
  }

  /**
   * Actualiza las propiedades operativas o el personal asignado a un servicio existente.
   *
   * @remarks
   * Consistencia Transaccional:
   * Valida que el nuevo nombre no genere colisión con otro servicio de la misma sede
   * y reasocia de forma segura los identificadores de barberos activos.
   *
   * @param id - Identificador primario del servicio a modificar.
   * @param dto - Campos modificados del servicio.
   * @returns Registro actualizado del servicio.
   * @throws {NotFoundException} Si el servicio no existe en la sede.
   * @throws {ConflictException} Si el nuevo nombre colisiona con otro servicio del negocio.
   */
  async actualizarServicio(id: number, dto: ActualizarServicioDto) {
    const servicioActual = await this.obtenerServicioPorId(id);

    if (dto.nombre && dto.nombre !== servicioActual.nombre) {
      const servicioConMismoNombre =
        await this.serviciosRepository.obtenerServicioPorNombre(dto.nombre);
      if (servicioConMismoNombre && servicioConMismoNombre.id !== id) {
        throw new ConflictException('Ya existe otro servicio con este nombre');
      }
    }

    // Seguridad Multitenant: Si se actualizan barberos, validar y normalizar al Barbero.id real
    let barberoIdsNormalizados: number[] | undefined = undefined;
    if (dto.barberoIds !== undefined) {
      barberoIdsNormalizados = await this.normalizarYValidarBarberosActivos(
        dto.barberoIds,
      );
    }

    return this.serviciosRepository.actualizarServicio(id, {
      nombre: dto.nombre,
      descripcion: dto.descripcion,
      precio: dto.precio,
      duracionMinutos: dto.duracionMinutos,
      fotoUrl: dto.fotoUrl,
      barberoIds: barberoIdsNormalizados,
    });
  }

  /**
   * Ejecuta un borrado lógico (soft delete) alternando el estado de un servicio entre ACTIVO e INACTIVO.
   *
   * @remarks
   * Integridad Referencial Histórica:
   * Los servicios nunca se eliminan físicamente (`DELETE FROM`) para preservar la integridad
   * de los registros de citas previas, métricas contables y reportes de rendimiento.
   *
   * @param id - Identificador primario del servicio.
   * @param dto - Nuevo estado deseado (`ACTIVO` o `INACTIVO`).
   * @returns Servicio con el nuevo estado persistido.
   * @throws {NotFoundException} Si el servicio no existe en la sede.
   */
  async cambiarEstadoServicio(id: number, dto: CambiarEstadoServicioDto) {
    await this.obtenerServicioPorId(id);
    return this.serviciosRepository.cambiarEstado(id, dto.estado);
  }

  /**
   * Almacena y asocia una nueva imagen representativa para el servicio.
   *
   * @remarks
   * Prevención de Fugas de Almacenamiento (Garbage Collection de Archivos):
   * Si el servicio ya poseía una imagen local en `/uploads/servicios/`, se elimina el archivo previo
   * del disco antes de registrar el nuevo para evitar el consumo acumulativo e innecesario de almacenamiento.
   *
   * @param id - Identificador primario del servicio.
   * @param archivo - Archivo recibido y validado por el interceptor Multer.
   * @returns Objeto con la URL relativa de la nueva imagen y el servicio actualizado.
   * @throws {NotFoundException} Si el servicio no existe en la sede.
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
    const servicioActualizado =
      await this.serviciosRepository.actualizarServicio(id, {
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
          console.warn(
            'No se pudo eliminar el archivo físico de la foto del servicio:',
            e,
          );
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
   *
   * `id` es el `Barbero.id` (NO el `Usuario.id`): es la clave que consumen la
   * disponibilidad y la reserva, de modo que el cliente puede encadenar
   * catálogo → disponibilidad → reserva sin traducir identificadores.
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
        id: bs.barbero.id,
        nombre: bs.barbero.usuario.nombre,
        apellido: bs.barbero.usuario.apellido,
        fotoUrl: bs.barbero.fotoUrl,
      })),
    };
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Representación desacoplada de una fila de `configuraciones_sistema`, para no
 * exponer los tipos generados de Prisma al resto de la aplicación.
 */
export interface ConfiguracionRegistro {
  clave: string;
  valor: string;
  tipo: string;
  editable: boolean;
}

/**
 * Acceso a `configuraciones_sistema`.
 *
 * Centraliza la lectura de parámetros funcionales almacenados en base de datos.
 * No contiene reglas de negocio ni conversión de tipos: eso vive en
 * `ConfiguracionService`.
 */
@Injectable()
export class ConfiguracionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Devuelve la configuración con la clave indicada, o `null` si no existe.
   * Usa `select` explícito para traer solo los campos necesarios.
   */
  async buscarPorClave(clave: string): Promise<ConfiguracionRegistro | null> {
    const registro = await this.prisma.configuracionSistema.findUnique({
      where: { clave },
      select: { clave: true, valor: true, tipo: true, editable: true },
    });

    return registro ?? null;
  }

  /** Devuelve todas las configuraciones registradas, ordenadas por clave. */
  async listar(): Promise<ConfiguracionRegistro[]> {
    return this.prisma.configuracionSistema.findMany({
      select: { clave: true, valor: true, tipo: true, editable: true },
      orderBy: { clave: 'asc' },
    });
  }
}

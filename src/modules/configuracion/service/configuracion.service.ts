import { Injectable, Logger } from '@nestjs/common';
import {
  ConfiguracionRepository,
  ConfiguracionRegistro,
} from '../repository/configuracion.repository';
import {
  TipoConfiguracion,
  TTL_CACHE_CONFIGURACION_MS,
} from '../configuracion.constants';

interface EntradaCache {
  registro: ConfiguracionRegistro | null;
  expiraEn: number;
}

/**
 * Servicio centralizado de configuración funcional leída desde base de datos.
 *
 * Traduce el contenido textual almacenado en `configuraciones_sistema` al tipo
 * solicitado, validándolo sin `eval` ni conversiones inseguras. Ante una
 * configuración ausente, de tipo incorrecto o con valor inválido, devuelve el
 * valor por defecto recibido y deja constancia en el log (comportamiento
 * seguro y documentado).
 *
 * Caché: mantiene los valores en memoria durante `TTL_CACHE_CONFIGURACION_MS`
 * para evitar consultas repetidas, pero la caducidad garantiza que los cambios
 * en base de datos se reflejen sin reiniciar la aplicación. `invalidarCache()`
 * permite refrescar de inmediato cuando exista una escritura.
 */
@Injectable()
export class ConfiguracionService {
  private readonly logger = new Logger(ConfiguracionService.name);
  private readonly cache = new Map<string, EntradaCache>();

  constructor(
    private readonly configuracionRepository: ConfiguracionRepository,
  ) {}

  /** Devuelve el valor como número entero/decimal, o `porDefecto` si es inválido. */
  async obtenerNumero(clave: string, porDefecto: number): Promise<number> {
    return this.obtenerTipado(
      clave,
      TipoConfiguracion.NUMERO,
      (valor) => {
        const numero = Number(valor);
        return Number.isFinite(numero) ? numero : null;
      },
      porDefecto,
    );
  }

  /** Devuelve el valor como texto, o `porDefecto` si la configuración falta. */
  async obtenerTexto(clave: string, porDefecto: string): Promise<string> {
    return this.obtenerTipado(
      clave,
      TipoConfiguracion.TEXTO,
      (valor) => valor,
      porDefecto,
    );
  }

  /** Devuelve el valor como booleano, o `porDefecto` si es inválido. */
  async obtenerBooleano(clave: string, porDefecto: boolean): Promise<boolean> {
    return this.obtenerTipado(
      clave,
      TipoConfiguracion.BOOLEANO,
      (valor) => {
        const normalizado = valor.trim().toLowerCase();
        if (normalizado === 'true' || normalizado === '1') {
          return true;
        }
        if (normalizado === 'false' || normalizado === '0') {
          return false;
        }
        return null;
      },
      porDefecto,
    );
  }

  /** Devuelve el valor como JSON tipado, o `porDefecto` si no es JSON válido. */
  async obtenerJson<T>(clave: string, porDefecto: T): Promise<T> {
    return this.obtenerTipado<T>(
      clave,
      TipoConfiguracion.JSON,
      (valor) => {
        try {
          return JSON.parse(valor) as T;
        } catch {
          return null;
        }
      },
      porDefecto,
    );
  }

  /**
   * Invalida la caché de una clave concreta, o de todas si no se indica ninguna.
   * Debe invocarse tras una escritura de configuración para reflejarla de
   * inmediato.
   */
  invalidarCache(clave?: string): void {
    if (clave === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(clave);
  }

  private async obtenerTipado<T>(
    clave: string,
    tipoEsperado: TipoConfiguracion,
    convertir: (valor: string) => T | null,
    porDefecto: T,
  ): Promise<T> {
    const registro = await this.obtenerRegistro(clave);

    if (!registro) {
      this.logger.warn(
        `Configuración '${clave}' no encontrada; se usa el valor por defecto.`,
      );
      return porDefecto;
    }

    if (registro.tipo !== tipoEsperado) {
      this.logger.warn(
        `Configuración '${clave}' tiene tipo '${registro.tipo}' y se esperaba '${tipoEsperado}'; se usa el valor por defecto.`,
      );
      return porDefecto;
    }

    const convertido = convertir(registro.valor);
    if (convertido === null) {
      this.logger.warn(
        `Configuración '${clave}' tiene un valor inválido ('${registro.valor}'); se usa el valor por defecto.`,
      );
      return porDefecto;
    }

    return convertido;
  }

  private async obtenerRegistro(
    clave: string,
  ): Promise<ConfiguracionRegistro | null> {
    const ahora = Date.now();
    const enCache = this.cache.get(clave);

    if (enCache && enCache.expiraEn > ahora) {
      return enCache.registro;
    }

    const registro = await this.configuracionRepository.buscarPorClave(clave);
    this.cache.set(clave, {
      registro,
      expiraEn: ahora + TTL_CACHE_CONFIGURACION_MS,
    });

    return registro;
  }
}

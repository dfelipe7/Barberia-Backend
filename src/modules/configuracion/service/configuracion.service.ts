import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ConfiguracionRepository,
  ConfiguracionRegistro,
} from '../repository/configuracion.repository';
import {
  CLAVES_CON_FALLBACK_GLOBAL,
  claveCacheGlobal,
  claveCacheNegocio,
  TipoConfiguracion,
  TTL_CACHE_CONFIGURACION_MS,
} from '../configuracion.constants';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { NegociosRepository } from '../../negocios/repository/negocios.repository';

/**
 * Ámbito de lectura de una configuración.
 *
 * - `NEGOCIO`: valor efectivo del negocio activo (política operativa).
 * - `GLOBAL`: parámetro global de plataforma (`configuraciones_sistema`).
 */
export type AmbitoConfiguracion = 'NEGOCIO' | 'GLOBAL';

/**
 * Límites que debe respetar un valor numérico.
 *
 * Un valor fuera de los límites se considera INVÁLIDO: no se aplica y la
 * resolución continúa con el siguiente candidato. Así un valor corrupto en
 * base de datos no puede producir un `NaN` ni una política insegura.
 */
export interface LimitesNumericos {
  /** Valor mínimo admisible (inclusive). */
  minimo?: number;
  /** Valor máximo admisible (inclusive). */
  maximo?: number;
  /** Trunca el valor a un entero (minutos). */
  entero?: boolean;
}

/** Entrada de la caché segmentada por ámbito. */
interface EntradaCache {
  registro: ConfiguracionRegistro | null;
  expiraEn: number;
}

/** Candidato de resolución: un registro y el ámbito del que procede. */
interface CandidatoConfiguracion {
  registro: ConfiguracionRegistro | null;
  ambito: AmbitoConfiguracion;
}

/**
 * Servicio centralizado de configuración funcional leída desde base de datos.
 *
 * RESOLUCIÓN DEL VALOR EFECTIVO (ámbito de negocio)
 * --------------------------------------------------
 *   1. La configuración del NEGOCIO ACTIVO, por `(negocioId, clave)`.
 *   2. Si no existe (o es inválida) y la política de compatibilidad lo
 *      permite, la configuración GLOBAL de plataforma.
 *   3. Si tampoco hay un valor global válido, el VALOR POR DEFECTO del
 *      código.
 *
 * El primer candidato VÁLIDO gana: un valor corrupto en el negocio no impide
 * que se use el global o el valor por defecto (y nunca se aplica un valor
 * inválido).
 *
 * CACHÉ SEGMENTADA
 * ----------------
 * Las claves de caché llevan el ámbito: `negocio:<id>:<clave>` para las
 * políticas de negocio y `global:<clave>` para los parámetros de plataforma.
 * Dos negocios pueden tener valores distintos de la misma clave, y la
 * invalidación de uno no afecta a los demás. El valor heredado del ámbito
 * global NUNCA se cachea como si fuera una configuración del negocio: el
 * negocio cachea su propia fila (o su ausencia) y el global se cachea en su
 * propia clave.
 *
 * SEGURIDAD
 * ---------
 * El `negocioId` se toma SIEMPRE del contexto validado por el servidor. Si la
 * petición no tiene contexto de negocio, la lectura de una configuración
 * operativa FALLA de forma controlada: no se leen los valores de otra
 * barbería ni se degradan silenciosamente a un valor global.
 */
@Injectable()
export class ConfiguracionService {
  private readonly logger = new Logger(ConfiguracionService.name);
  private readonly cache = new Map<string, EntradaCache>();

  constructor(
    private readonly configuracionRepository: ConfiguracionRepository,
    private readonly contextoService: NegocioContextoService,
    private readonly aislamientoService: NegocioAislamientoService,
    private readonly negociosRepository: NegociosRepository,
  ) {}

  /**
   * Valor efectivo del NEGOCIO activo como número.
   *
   * @param limites Límites que debe respetar el valor. Un valor fuera de ellos
   * se trata como inválido y se continua la resolución (global o defecto).
   */
  async obtenerNumero(
    clave: string,
    porDefecto: number,
    limites?: LimitesNumericos,
  ): Promise<number> {
    return this.obtenerTipado(
      clave,
      TipoConfiguracion.NUMERO,
      convertirNumero,
      porDefecto,
      'NEGOCIO',
      limites,
    );
  }

  /** Valor efectivo del NEGOCIO activo como texto. */
  async obtenerTexto(clave: string, porDefecto: string): Promise<string> {
    return this.obtenerTipado(
      clave,
      TipoConfiguracion.TEXTO,
      (valor) => valor,
      porDefecto,
      'NEGOCIO',
    );
  }

  /** Valor efectivo del NEGOCIO activo como booleano. */
  async obtenerBooleano(clave: string, porDefecto: boolean): Promise<boolean> {
    return this.obtenerTipado(
      clave,
      TipoConfiguracion.BOOLEANO,
      convertirBooleano,
      porDefecto,
      'NEGOCIO',
    );
  }

  /** Valor efectivo del NEGOCIO activo como JSON tipado. */
  async obtenerJson<T>(clave: string, porDefecto: T): Promise<T> {
    return this.obtenerTipado<T>(
      clave,
      TipoConfiguracion.JSON,
      convertirJson,
      porDefecto,
      'NEGOCIO',
    );
  }

  /**
   * Texto del NEGOCIO ACTIVO, SIN alternativa global.
   *
   * A diferencia de `obtenerTexto`, este método NUNCA consulta el ámbito
   * global de plataforma: si el negocio no tiene la clave, devuelve el valor
   * por defecto.
   *
   * Existe para los casos en que un dato debe pertenecer SIEMPRE a una
   * barbería (por ejemplo, la dirección comercial heredada que se usa como
   * respaldo temporal): leer el ámbito global podría devolver el valor de
   * otra barbería o el de la plataforma.
   */
  async obtenerTextoDelNegocio(
    clave: string,
    porDefecto: string,
  ): Promise<string> {
    return this.obtenerTipado(
      clave,
      TipoConfiguracion.TEXTO,
      (valor) => valor,
      porDefecto,
      'NEGOCIO',
      undefined,
      { soloNegocio: true },
    );
  }

  /** Parámetro GLOBAL de plataforma como número. */
  async obtenerNumeroGlobal(
    clave: string,
    porDefecto: number,
    limites?: LimitesNumericos,
  ): Promise<number> {
    return this.obtenerTipado(
      clave,
      TipoConfiguracion.NUMERO,
      convertirNumero,
      porDefecto,
      'GLOBAL',
      limites,
    );
  }

  /** Parámetro GLOBAL de plataforma como texto. */
  async obtenerTextoGlobal(clave: string, porDefecto: string): Promise<string> {
    return this.obtenerTipado(
      clave,
      TipoConfiguracion.TEXTO,
      (valor) => valor,
      porDefecto,
      'GLOBAL',
    );
  }

  /** Parámetro GLOBAL de plataforma como booleano. */
  async obtenerBooleanoGlobal(
    clave: string,
    porDefecto: boolean,
  ): Promise<boolean> {
    return this.obtenerTipado(
      clave,
      TipoConfiguracion.BOOLEANO,
      convertirBooleano,
      porDefecto,
      'GLOBAL',
    );
  }

  /** Parámetro GLOBAL de plataforma como JSON tipado. */
  async obtenerJsonGlobal<T>(clave: string, porDefecto: T): Promise<T> {
    return this.obtenerTipado<T>(
      clave,
      TipoConfiguracion.JSON,
      convertirJson,
      porDefecto,
      'GLOBAL',
    );
  }

  /**
   * Invalida la caché de una clave concreta, o de todas si no se indica ninguna.
   *
   * Con clave, invalida la entrada de la clave en el ámbito del NEGOCIO ACTIVO
   * (si la petición tiene contexto) y la entrada GLOBAL de esa misma clave: los
   * dos son candidatos del valor efectivo. NO toca las entradas de OTROS
   * negocios.
   */
  invalidarCache(clave?: string): void {
    if (clave === undefined) {
      this.cache.clear();
      return;
    }

    const contexto = this.contextoService.obtenerContexto();

    if (contexto) {
      this.cache.delete(claveCacheNegocio(contexto.id, clave));
    }

    this.cache.delete(claveCacheGlobal(clave));
  }

  /**
   * Invalida la caché de una clave en un NEGOCIO concreto, sin afectar a
   * ningún otro negocio.
   */
  invalidarCacheNegocio(negocioId: number, clave: string): void {
    this.cache.delete(claveCacheNegocio(negocioId, clave));
  }

  /** Invalida la caché de un parámetro GLOBAL de plataforma. */
  invalidarCacheGlobal(clave: string): void {
    this.cache.delete(claveCacheGlobal(clave));
  }

  /**
   * INICIALIZA (de forma idempotente) las configuraciones operativas de un
   * negocio.
   *
   * Crea únicamente las claves que el negocio no tiene, con el valor semilla
   * de la política. Las claves ya existentes se CONSERVAN: su valor puede
   * estar personalizado por un administrador. Ejecutarla dos veces NO cambia
   * nada la segunda vez.
   *
   * La operación se ejecuta DENTRO del contexto del negocio inicializado: así
   * las escrituras quedan asociadas a ese negocio (la extensión de aislamiento
   * fuerza el `negocioId` del contexto) y no a otro.
   */
  async inicializarValoresOperativos(negocioId: number): Promise<{
    creadas: string[];
    conservadas: string[];
  }> {
    const negocio = await this.negociosRepository.buscarPorId(negocioId);

    if (!negocio) {
      throw new NotFoundException('El negocio no existe');
    }

    const resultado = await this.aislamientoService.ejecutarEnNegocio(
      negocio,
      () =>
        this.configuracionRepository.inicializarValoresOperativos(negocio.id),
    );

    for (const clave of [...resultado.creadas, ...resultado.conservadas]) {
      this.invalidarCacheNegocio(negocio.id, clave);
    }

    return resultado;
  }

  /**
   * Guarda el valor textual de una clave de configuración de un NEGOCIO.
   *
   * La escritura se ejecuta DENTRO del contexto del negocio: así la fila queda
   * asociada a ese negocio y la extensión de aislamiento impide que se toque
   * la configuración de otro. La caché de ese negocio se invalida.
   *
   * Si la clave ya existe con OTRO tipo (por ejemplo, una clave numérica), la
   * escritura FALLA y el registro se conserva: el tipo de una configuración no
   * cambia por el hecho de guardar un valor nuevo. La corrección de un
   * registro heredado con tipo incorrecto es explícita (`corregirTipo`).
   */
  async guardarTexto(
    negocioId: number,
    clave: string,
    valor: string,
    opciones: { corregirTipo?: boolean } = {},
  ): Promise<void> {
    await this.guardarEnNegocio(negocioId, clave, valor, 'TEXTO', opciones);
  }

  /**
   * Guarda un valor NUMERO de la configuración de un negocio.
   *
   * El tipo importa: un número guardado como texto NO sería válido al leerlo
   * con `obtenerNumero` (la resolución descarta los valores de tipo
   * incorrecto) y la política se perdería. Por eso el tipo se escribe de
   * forma explícita y NO se degrada por una escritura posterior de texto.
   */
  async guardarNumero(
    negocioId: number,
    clave: string,
    valor: number,
    opciones: { corregirTipo?: boolean } = {},
  ): Promise<void> {
    await this.guardarEnNegocio(
      negocioId,
      clave,
      String(valor),
      'NUMERO',
      opciones,
    );
  }

  /** Escritura de la configuración de un negocio, dentro de SU contexto. */
  private async guardarEnNegocio(
    negocioId: number,
    clave: string,
    valor: string,
    tipo: 'TEXTO' | 'NUMERO',
    opciones: { corregirTipo?: boolean },
  ): Promise<void> {
    const negocio = await this.negociosRepository.buscarPorId(negocioId);

    if (!negocio) {
      throw new NotFoundException('El negocio no existe');
    }

    await this.aislamientoService.ejecutarEnNegocio(negocio, () =>
      this.configuracionRepository.guardarEnNegocio(
        negocio.id,
        clave,
        valor,
        tipo,
        opciones,
      ),
    );

    this.invalidarCacheNegocio(negocio.id, clave);
  }

  /**
   * Resolución tipada del valor efectivo.
   *
   * Se recorren los candidatos EN ORDEN (negocio -> global -> defecto) y gana
   * el primero que sea válido. Un candidato con tipo incorrecto o con un valor
   * inválido se descarta (queda registrado en el log) y la resolución sigue.
   */
  private async obtenerTipado<T>(
    clave: string,
    tipoEsperado: TipoConfiguracion,
    convertir: (valor: string) => T | null,
    porDefecto: T,
    ambito: AmbitoConfiguracion,
    limites?: LimitesNumericos,
    opciones: { soloNegocio?: boolean } = {},
  ): Promise<T> {
    for (const candidato of await this.candidatos(clave, ambito, opciones)) {
      const registro = candidato.registro;

      if (!registro) {
        continue;
      }

      if (registro.tipo !== tipoEsperado) {
        this.logger.warn(
          `Configuración '${clave}' (ámbito ${candidato.ambito}) tiene tipo '${registro.tipo}' y se esperaba '${tipoEsperado}'; se descarta.`,
        );
        continue;
      }

      const convertido = convertir(registro.valor);

      if (convertido === null) {
        this.logger.warn(
          `Configuración '${clave}' (ámbito ${candidato.ambito}) tiene un valor inválido ('${registro.valor}'); se descarta.`,
        );
        continue;
      }

      const validado = this.validar(convertido, limites);

      if (validado === null) {
        this.logger.warn(
          `Configuración '${clave}' (ámbito ${candidato.ambito}) tiene un valor fuera de los límites admitidos ('${registro.valor}'); se descarta.`,
        );
        continue;
      }

      return validado;
    }

    return porDefecto;
  }

  /**
   * Candidatos de resolución, en orden de preferencia.
   *
   * En el ámbito de negocio, el segundo candidato (el global) solo se incluye
   * si la política de compatibilidad lo permite para esa clave. Con
   * `soloNegocio` NO se incluye nunca: el valor debe pertenecer a la
   * barbería del contexto.
   */
  private async candidatos(
    clave: string,
    ambito: AmbitoConfiguracion,
    opciones: { soloNegocio?: boolean } = {},
  ): Promise<CandidatoConfiguracion[]> {
    if (ambito === 'GLOBAL') {
      return [{ registro: await this.registroGlobal(clave), ambito: 'GLOBAL' }];
    }

    const negocioId = this.negocioIdRequerido();

    const candidatos: CandidatoConfiguracion[] = [
      {
        registro: await this.registroNegocio(negocioId, clave),
        ambito: 'NEGOCIO',
      },
    ];

    if (CLAVES_CON_FALLBACK_GLOBAL.has(clave) && !opciones.soloNegocio) {
      candidatos.push({
        registro: await this.registroGlobal(clave),
        ambito: 'GLOBAL',
      });
    }

    return candidatos;
  }

  /**
   * Identificador del negocio activo.
   *
   * @throws ForbiddenException si la petición no tiene contexto de negocio
   * autorizado. Es un fallo SEGURO: es preferible rechazar la lectura a
   * devolver la política de otra barbería.
   */
  private negocioIdRequerido(): number {
    const contexto = this.contextoService.obtenerContexto();

    if (!contexto) {
      throw new ForbiddenException(
        'La lectura de la configuración del negocio requiere un contexto de negocio autorizado',
      );
    }

    return contexto.id;
  }

  /** Lectura cacheada de la configuración del negocio. */
  private async registroNegocio(
    negocioId: number,
    clave: string,
  ): Promise<ConfiguracionRegistro | null> {
    return this.leerCacheado(claveCacheNegocio(negocioId, clave), () =>
      this.configuracionRepository.buscarPorClaveEnNegocio(negocioId, clave),
    );
  }

  /** Lectura cacheada de la configuración global de plataforma. */
  private async registroGlobal(
    clave: string,
  ): Promise<ConfiguracionRegistro | null> {
    return this.leerCacheado(claveCacheGlobal(clave), () =>
      this.configuracionRepository.buscarPorClave(clave),
    );
  }

  /**
   * Lee (y cachea) un registro respetando el TTL.
   *
   * La entrada obsoleta se elimina al detectarla: no quedan valores
   * indefinidamente en la caché, y la próxima lectura vuelve a la base de
   * datos.
   */
  private async leerCacheado(
    claveCache: string,
    cargar: () => Promise<ConfiguracionRegistro | null>,
  ): Promise<ConfiguracionRegistro | null> {
    const ahora = Date.now();
    const enCache = this.cache.get(claveCache);

    if (enCache) {
      if (enCache.expiraEn > ahora) {
        return enCache.registro;
      }
      this.cache.delete(claveCache);
    }

    const registro = await cargar();

    this.cache.set(claveCache, {
      registro,
      expiraEn: ahora + TTL_CACHE_CONFIGURACION_MS,
    });

    return registro;
  }

  /**
   * Aplica los límites al valor convertido.
   *
   * @returns el valor admits, o `null` si no cumple los límites.
   */
  private validar<T>(valor: T, limites?: LimitesNumericos): T | null {
    if (!limites) {
      return valor;
    }

    if (typeof valor !== 'number' || !Number.isFinite(valor)) {
      return null;
    }

    if (limites.minimo !== undefined && valor < limites.minimo) {
      return null;
    }

    if (limites.maximo !== undefined && valor > limites.maximo) {
      return null;
    }

    return (limites.entero ? Math.floor(valor) : valor) as T;
  }
}

/** Convierte un valor textual en número finito, o `null` si no lo es. */
function convertirNumero(valor: string): number | null {
  const numero = Number(valor.trim());

  return Number.isFinite(numero) ? numero : null;
}

/** Convierte un valor textual en booleano, o `null` si no lo es. */
function convertirBooleano(valor: string): boolean | null {
  const normalizado = valor.trim().toLowerCase();

  if (normalizado === 'true' || normalizado === '1') {
    return true;
  }

  if (normalizado === 'false' || normalizado === '0') {
    return false;
  }

  return null;
}

/** Convierte un valor textual en JSON, o `null` si no es JSON válido. */
function convertirJson<T>(valor: string): T | null {
  try {
    return JSON.parse(valor) as T;
  } catch {
    return null;
  }
}

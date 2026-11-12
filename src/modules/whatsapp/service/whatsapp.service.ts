import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as path from 'node:path';
import * as os from 'node:os';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActualizarPlantillasDto } from '../dto/actualizar-plantillas.dto';
import {
  PlantillaWhatsApp,
  WhatsAppPlantillasRepository,
} from '../repository/whatsapp-plantillas.repository';
import { ConfiguracionService } from '../../configuracion/service/configuracion.service';
import { CLAVES_CONFIGURACION } from '../../configuracion/configuracion.constants';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { NegociosRepository } from '../../negocios/repository/negocios.repository';
import { PerfilNegocioService } from '../../perfil-negocio/service/perfil-negocio.service';

import {
  esLogRuidosoLibsignal,
  formatearNumeroAJid as formatearJidUtil,
  enmascararTelefono,
} from '../utils/whatsapp-phone.util';
import {
  PLANTILLA_CONFIRMACION_DEFAULT,
  PLANTILLA_RECORDATORIO_DEFAULT,
  MINUTOS_ANTICIPACION_DEFAULT,
  type DatosConfirmacionWhatsApp,
  type MensajeColaWhatsApp,
  type SesionWhatsAppNegocio,
  type EstadoWhatsAppDTO,
} from '../types/whatsapp.types';
import { WhatsAppTemplateEngine } from '../templates/whatsapp-template.engine';
import { WhatsAppQueueManager } from '../queue/whatsapp-queue.manager';
import { WhatsAppSessionManager } from '../session/whatsapp-session.manager';

export {
  PLANTILLA_CONFIRMACION_DEFAULT,
  PLANTILLA_RECORDATORIO_DEFAULT,
  MINUTOS_ANTICIPACION_DEFAULT,
  enmascararTelefono,
  type DatosConfirmacionWhatsApp,
  type MensajeColaWhatsApp,
  type SesionWhatsAppNegocio,
  type EstadoWhatsAppDTO,
};

const originalConsoleInfo = console.info;
console.info = (...args: unknown[]) => {
  if (esLogRuidosoLibsignal(...args)) return;
  originalConsoleInfo(...(args as Parameters<typeof console.info>));
};

const originalConsoleWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (esLogRuidosoLibsignal(...args)) return;
  originalConsoleWarn(...(args as Parameters<typeof console.warn>));
};

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (esLogRuidosoLibsignal(...args)) return;
  originalConsoleError(...(args as Parameters<typeof console.error>));
};

/**
 * Servicio Fachada (Facade) para la Integración de WhatsApp Web con Baileys.
 *
 * @remarks
 * Orquesta la infraestructura de mensajería multitenant del SaaS:
 * - **Gestión de Sesiones**: Delega el ciclo de vida de los sockets, códigos QR y reconexiones en `WhatsAppSessionManager`.
 * - **Cola en Memoria y Reintentos**: Delega la retención temporal de mensajes pendientes y validación JIT en `WhatsAppQueueManager`.
 * - **Plantillas Dinámicas**: Delega la interpolación de variables de reserva y branding en `WhatsAppTemplateEngine`.
 * - **Persistencia**: Delega el almacenamiento y reseteo de plantillas en `WhatsAppPlantillasRepository`.
 * Garantiza total aislamiento multitenant asociando cada sesión y cola de mensajes al `negocioId` del contexto.
 */
@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly sesiones = new Map<number, SesionWhatsAppNegocio>();
  private readonly queueManager = new WhatsAppQueueManager();
  private readonly sessionManager: WhatsAppSessionManager;
  private readonly baseSessionDir: string;

  /**
   * Getter de compatibilidad hacia atrás para colas pendientes.
   * Usado por observadores internos y suite de pruebas unitarias.
   */
  get colasPendientes(): Map<number, MensajeColaWhatsApp[]> {
    return this.queueManager.colas;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly plantillasRepository: WhatsAppPlantillasRepository,
    private readonly configuracionService: ConfiguracionService,
    private readonly contextoService: NegocioContextoService,
    private readonly negociosRepository: NegociosRepository,
    private readonly perfilNegocioService: PerfilNegocioService,
  ) {
    this.baseSessionDir =
      process.env.WHATSAPP_SESSION_PATH ||
      path.join(os.homedir(), '.barberia_whatsapp_sessions');
    this.sessionManager = new WhatsAppSessionManager(
      this.sesiones,
      this.baseSessionDir,
    );
  }

  /**
   * Resuelve el negocioId objetivo:
   * 1. Parámetro explícito negocioIdParam (si > 0).
   * 2. Negocio del contexto de la petición actual (AsyncLocalStorage).
   * 3. Fallback a 1 (Kyrios Studio / tenant principal).
   */
  resolverNegocioId(negocioIdParam?: number | null): number {
    if (negocioIdParam && negocioIdParam > 0) {
      return negocioIdParam;
    }
    const contexto = this.contextoService.obtenerContexto();
    if (contexto?.id) {
      return contexto.id;
    }
    return 1;
  }

  /**
   * Obtiene la ruta en disco de la sesión de un negocio específico.
   */
  obtenerDirectorioSesion(negocioId: number): string {
    return this.sessionManager.obtenerDirectorioSesion(negocioId);
  }

  /**
   * Obtiene o instancia el estado en memoria de la sesión del negocio.
   */
  private obtenerOCrearSesion(negocioId: number): SesionWhatsAppNegocio {
    return this.sessionManager.obtenerOCrearSesion(negocioId);
  }

  /**
   * Determina si ya existe una sesión guardada y debidamente autenticada en el disco
   * para el negocio indicado (o el negocio del contexto).
   */
  tieneSesionGuardada(negocioIdParam?: number): boolean {
    return this.sessionManager.tieneSesionGuardada(
      this.resolverNegocioId(negocioIdParam),
    );
  }

  async onModuleInit() {
    this.logger.log(
      `Servicio de WhatsApp Multi-Tenant inicializado (Directorio base: ${this.baseSessionDir})`,
    );

    try {
      const negocios = await this.negociosRepository.listar();
      for (const negocio of negocios) {
        if (this.tieneSesionGuardada(negocio.id)) {
          const sesion = this.obtenerOCrearSesion(negocio.id);
          sesion.enReposo = false;
          this.logger.log(
            `[Negocio ${negocio.id} - ${negocio.nombre}] Sesión previa encontrada en disco. Conectando automáticamente con WhatsApp Web...`,
          );
          await this.iniciarSocket(negocio.id);
        } else {
          this.logger.log(
            `[Negocio ${negocio.id} - ${negocio.nombre}] Sin sesión vinculada. En modo REPOSO (se generará el código QR bajo demanda).`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `No se pudieron listar los negocios para restaurar sesiones de WhatsApp: ${error}`,
      );
      if (this.tieneSesionGuardada(1)) {
        const sesion1 = this.obtenerOCrearSesion(1);
        sesion1.enReposo = false;
        await this.iniciarSocket(1);
      }
    }
  }

  onModuleDestroy() {
    for (const [, sesion] of this.sesiones) {
      this.destruirSocket(sesion);
    }
  }

  private destruirSocket(sesion: SesionWhatsAppNegocio) {
    this.sessionManager.destruirSocket(sesion);
  }

  /**
   * Inicializa el socket de Baileys para la sesión del negocio especificado.
   */
  async iniciarSocket(negocioIdParam?: number): Promise<void> {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    let nombreNegocio: string | undefined;
    try {
      const negocio = await this.negociosRepository.buscarPorId(negocioId);
      if (negocio?.nombre) nombreNegocio = negocio.nombre;
    } catch {
      // Ignorar fallo de lectura y usar fallback de nombre
    }

    return this.sessionManager.iniciarSocket(negocioId, {
      nombreNegocio,
      onConnected: (id) => void this.despacharColaPendiente(id),
    });
  }

  getStatus(negocioIdParam?: number): {
    conectado: boolean;
    qr: string | null;
  } {
    return this.sessionManager.getStatus(
      this.resolverNegocioId(negocioIdParam),
    );
  }

  /**
   * Comprueba si hay al menos una sesión de WhatsApp conectada en cualquier sede.
   */
  hayAlgunaSesionConectada(): boolean {
    return this.sessionManager.hayAlgunaSesionConectada();
  }

  /**
   * Reactiva el socket bajo demanda para vincular WhatsApp generando un código QR nuevo.
   */
  iniciar(negocioIdParam?: number): { mensaje: string } {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    const sesion = this.obtenerOCrearSesion(negocioId);

    sesion.enReposo = false;
    if (sesion.isConnected) {
      void this.despacharColaPendiente(negocioId);
      return { mensaje: 'WhatsApp ya se encuentra conectado.' };
    }
    if (sesion.isConnecting) {
      return { mensaje: 'WhatsApp ya está iniciando.' };
    }
    if (sesion.sock) {
      this.destruirSocket(sesion);
    }
    this.logger.log(
      `[Negocio ${negocioId}] Iniciando socket de WhatsApp bajo demanda...`,
    );
    void this.iniciarSocket(negocioId);
    return { mensaje: 'Iniciando WhatsApp...' };
  }

  /**
   * Pone a WhatsApp en reposo inmediato cerrando el socket activo y cancelando temporizadores.
   */
  pausar(negocioIdParam?: number): { mensaje: string } {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    return this.sessionManager.pausar(negocioId, (id) =>
      this.tieneSesionGuardada(id),
    );
  }

  /**
   * Cierra la sesión activa de WhatsApp de forma controlada y desvincula el dispositivo.
   */
  async desconectar(negocioIdParam?: number): Promise<{ mensaje: string }> {
    return this.sessionManager.desconectar(
      this.resolverNegocioId(negocioIdParam),
    );
  }

  /**
   * Normaliza un número telefónico a formato internacional JID de WhatsApp.
   * Por defecto asume código de país Colombia (+57) para números celulares de 10 dígitos.
   */
  formatearNumeroAJid(telefono: string): string | null {
    return formatearJidUtil(telefono);
  }

  async enviarMensaje(
    telefono: string,
    texto: string,
    negocioIdParam?: number,
  ): Promise<boolean> {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    const sesion = this.obtenerOCrearSesion(negocioId);

    if (!sesion.isConnected || !sesion.sock) {
      this.logger.warn(
        `[Negocio ${negocioId}] No se envió el mensaje a ${enmascararTelefono(telefono)}: WhatsApp no está conectado.`,
      );
      return false;
    }

    const jid = this.formatearNumeroAJid(telefono);
    if (!jid) {
      this.logger.warn(
        `[Negocio ${negocioId}] Teléfono inválido para WhatsApp: ${enmascararTelefono(telefono)}`,
      );
      return false;
    }

    try {
      await sesion.sock.sendMessage(jid, { text: texto });
      this.logger.log(
        `[Negocio ${negocioId}] Mensaje de WhatsApp enviado exitosamente a ${enmascararTelefono(jid)}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[Negocio ${negocioId}] Error enviando mensaje por WhatsApp a ${enmascararTelefono(jid)}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Sustituye las variables dinámicas de una plantilla con los datos reales de
   * la reserva.
   *
   * `{negocio}` y `{ubicacion}` son datos COMERCIALES de la barbería: se
   * resuelven con la información del negocio CONTEXTO (nunca con la de otro).
   */
  reemplazarVariables(
    plantilla: string,
    datos: DatosConfirmacionWhatsApp,
    comercial?: { nombre: string; direccion: string },
  ): string {
    return WhatsAppTemplateEngine.renderizar(plantilla, datos, comercial);
  }

  /**
   * Datos COMERCIALES del negocio del contexto actual.
   *
   * FUENTES DE VERDAD
   * -----------------
   * - NOMBRE: `Negocio.nombre` del negocio del CONTEXTO. No hay un nombre
   *   por defecto: un mensaje sin contexto no inventa la identidad de una
   *   barbería.
   * - DIRECCIÓN: `PerfilNegocio.direccion` del negocio del CONTEXTO. Es la
   *   fuente canónica.
   *
   * COMPATIBILIDAD TEMPORAL
   * -----------------------
   * Mientras existan valores históricos en la clave de configuración
   * `negocio_direccion`, se usan como RESPALDO cuando el perfil no tiene
   * dirección. Es un puente explícito y acotado:
   *
   * - Solo se lee del negocio del contexto (nunca de otro).
   * - Se avisa por log cuando se usa, para que se migren los valores.
   * - Se retira cuando se hayan revisado los valores existentes: basta con
   *   copiar la dirección al perfil y eliminar la clave
   *   `negocio_direccion` de `CLAVES_CONFIGURACION_OPERATIVA`.
   *
   * Si el negocio no tiene dirección en ninguna de las dos fuentes, la
   * dirección queda VACÍA: no se inventa ni se recurre a datos de otra
   * barbería (el mensaje sale sin la línea de ubicación).
   */
  private async datosComercialesDelNegocio(): Promise<{
    nombre: string;
    direccion: string;
  }> {
    const contexto = this.contextoService.obtenerContexto();

    if (!contexto) {
      return { nombre: '', direccion: '' };
    }

    const negocio = await this.negociosRepository.buscarPorId(contexto.id);
    const nombre = negocio?.nombre?.trim() ?? '';

    let direccion = await this.leerDireccionDelPerfil(contexto);

    if (!direccion) {
      direccion = await this.leerDireccionHistorica(contexto);
    }

    return { nombre, direccion };
  }

  /** Dirección canónica: la del PERFIL del negocio del contexto. */
  private async leerDireccionDelPerfil(contexto: {
    id: number;
    slug: string;
  }): Promise<string> {
    try {
      return await this.perfilNegocioService.obtenerDireccionComercial();
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la dirección del perfil del negocio ${contexto.slug}: ${(error as Error)?.message}`,
      );

      return '';
    }
  }

  /**
   * Respaldo TEMPORAL: la clave histórica `negocio_direccion`.
   *
   * La lectura es EXCLUSIVAMENTE del ámbito del NEGOCIO del contexto
   * (`obtenerTextoDelNegocio`): nunca consulta el ámbito global de
   * plataforma, de modo que un mensaje nunca puede llevar la dirección de
   * otra barbería.
   */
  private async leerDireccionHistorica(contexto: {
    id: number;
    slug: string;
  }): Promise<string> {
    try {
      const direccion = await this.configuracionService.obtenerTextoDelNegocio(
        CLAVES_CONFIGURACION.NEGOCIO_DIRECCION,
        '',
      );

      if (direccion) {
        this.logger.warn(
          `El negocio ${contexto.slug} usa la dirección histórica de la clave ` +
            `'${CLAVES_CONFIGURACION.NEGOCIO_DIRECCION}' porque su perfil no tiene ` +
            'dirección. Migre el valor al perfil y retire esa clave.',
        );
      }

      return direccion ?? '';
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la dirección del negocio ${contexto.slug}: ${(error as Error)?.message}`,
      );

      return '';
    }
  }

  /**
   * Identificador del negocio del contexto actual, o `null` si la operación es
   * de plataforma (gestión de las plantillas globales).
   */
  private negocioIdDelContexto(): number | null {
    return this.contextoService.obtenerContexto()?.id ?? null;
  }

  /**
   * Obtiene los minutos de anticipación configurados para enviar el recordatorio
   * automático.
   *
   * ORDEN DE RESOLUCIÓN (HU-11): la configuración del NEGOCIO tiene prioridad;
   * si no existe, se usa la plantilla GLOBAL de plataforma; si tampoco existe,
   * el valor por defecto (120 minutos).
   */
  async obtenerMinutosAnticipacion(): Promise<number> {
    const negocioId = this.negocioIdDelContexto();

    if (negocioId !== null) {
      try {
        const valor = await this.configuracionService.obtenerNumero(
          CLAVES_CONFIGURACION.RECORDATORIO_MINUTOS_ANTICIPACION,
          0,
          { minimo: 1, maximo: 10080, entero: true },
        );

        if (valor > 0) {
          return valor;
        }
      } catch (error) {
        this.logger.warn(
          `No se pudo leer la anticipación del negocio ${negocioId}: ${(error as Error)?.message}`,
        );
      }
    }

    const plantilla = await this.obtenerPlantillaGlobal(
      'CONFIG_RECORDATORIO_MINUTOS',
    );

    if (plantilla?.mensaje) {
      const parsed = Number.parseInt(plantilla.mensaje, 10);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }

    return MINUTOS_ANTICIPACION_DEFAULT;
  }

  /**
   * Obtiene la plantilla GLOBAL de plataforma de un tipo (`negocioId = NULL`).
   */
  private async obtenerPlantillaGlobal(
    tipo: string,
  ): Promise<PlantillaWhatsApp | null> {
    try {
      const plantillas =
        await this.plantillasRepository.obtenerPlantillas(null);
      return plantillas.find((p) => p.tipo === tipo) ?? null;
    } catch (err) {
      this.logger.warn(`Error leyendo la plantilla global '${tipo}': ${err}`);
      return null;
    }
  }

  /**
   * Obtiene las plantillas de mensajes configuradas en la base de datos o
   * retorna las predeterminadas.
   *
   * REGLA DE RESOLUCIÓN (HU-11): la plantilla del NEGOCIO tiene prioridad
   * sobre la GLOBAL de plataforma, que a su vez tiene prioridad sobre el texto
   * por defecto del código.
   */
  async obtenerPlantillas(): Promise<{
    confirmacion: string;
    recordatorio: string;
    minutosAnticipacion: number;
  }> {
    const minutosAnticipacion = await this.obtenerMinutosAnticipacion();
    const negocioId = this.negocioIdDelContexto();

    let plantillas: PlantillaWhatsApp[] = [];

    try {
      plantillas = await this.plantillasRepository.obtenerPlantillas(negocioId);
    } catch (err) {
      this.logger.warn(
        `Error leyendo plantillas de BD, usando valores por defecto: ${err}`,
      );
    }

    const elegir = (tipo: string, porDefecto: string): string => {
      const propia = plantillas.find(
        (p) => p.tipo === tipo && p.negocioId === negocioId,
      );
      if (propia?.mensaje) {
        return propia.mensaje;
      }

      const global = plantillas.find(
        (p) => p.tipo === tipo && p.negocioId === null,
      );

      return global?.mensaje || porDefecto;
    };

    return {
      confirmacion: elegir('CONFIRMACION', PLANTILLA_CONFIRMACION_DEFAULT),
      recordatorio: elegir('RECORDATORIO', PLANTILLA_RECORDATORIO_DEFAULT),
      minutosAnticipacion,
    };
  }

  /**
   * Actualiza o crea las plantillas de mensajes y configuración en la base de datos.
   *
   * @remarks
   * Política Multitenant (HU-11):
   * Las plantillas se persisten asociadas al ID del negocio activo del contexto.
   * Si no existe contexto de negocio (operación global de plataforma), se guardan
   * con `negocioId = null` como valores predeterminados globales de respaldo.
   *
   * @param dto - Textos de plantillas y minutos de anticipación configurados.
   * @returns Plantillas efectivas consolidadas tras la actualización.
   */
  async guardarPlantillas(dto: ActualizarPlantillasDto): Promise<{
    confirmacion: string;
    recordatorio: string;
    minutosAnticipacion: number;
  }> {
    const negocioId = this.negocioIdDelContexto();

    if (dto.confirmacion !== undefined && dto.confirmacion.trim() !== '') {
      await this.plantillasRepository.guardarPlantilla(
        negocioId,
        'CONFIRMACION',
        dto.confirmacion.trim(),
      );
    }

    if (dto.recordatorio !== undefined && dto.recordatorio.trim() !== '') {
      await this.plantillasRepository.guardarPlantilla(
        negocioId,
        'RECORDATORIO',
        dto.recordatorio.trim(),
      );
    }

    if (dto.minutosAnticipacion !== undefined && dto.minutosAnticipacion > 0) {
      // La anticipación es una POLÍTICA del negocio: se guarda en su
      // configuración, no en la plantilla global.
      if (negocioId !== null) {
        await this.configuracionService.guardarNumero(
          negocioId,
          CLAVES_CONFIGURACION.RECORDATORIO_MINUTOS_ANTICIPACION,
          dto.minutosAnticipacion,
        );
      } else {
        await this.plantillasRepository.guardarPlantilla(
          null,
          'CONFIG_RECORDATORIO_MINUTOS',
          String(dto.minutosAnticipacion),
        );
      }
    }

    return this.obtenerPlantillas();
  }

  /**
   * Restablece las plantillas de la sede a los textos oficiales por defecto del sistema.
   *
   * @remarks
   * Política Multitenant (HU-11):
   * Elimina las personalizaciones del negocio activo en base de datos para volver
   * a heredar las plantillas globales. La anticipación en minutos se reinicia a 120.
   *
   * @returns Plantillas efectivas restablecidas.
   */
  async resetPlantillas(): Promise<{
    confirmacion: string;
    recordatorio: string;
    minutosAnticipacion: number;
  }> {
    const negocioId = this.negocioIdDelContexto();

    if (negocioId !== null) {
      await this.plantillasRepository.eliminarPlantillas(negocioId, [
        'CONFIRMACION',
        'RECORDATORIO',
      ]);

      // La anticipación del negocio vive en su configuración: se restablece
      // también, para que el valor efectivo y la respuesta coincidan.
      await this.configuracionService.guardarNumero(
        negocioId,
        CLAVES_CONFIGURACION.RECORDATORIO_MINUTOS_ANTICIPACION,
        MINUTOS_ANTICIPACION_DEFAULT,
      );
    } else {
      await this.plantillasRepository.eliminarPlantillas(null, [
        'CONFIRMACION',
        'RECORDATORIO',
        'CONFIG_RECORDATORIO_MINUTOS',
      ]);
    }

    return this.obtenerPlantillas();
  }

  /**
   * Envía la confirmación inmediata de reserva al cliente usando la plantilla
   * configurada.
   *
   * La plantilla, la dirección y el nombre son los del NEGOCIO del contexto:
   * una reserva de A nunca produce un mensaje con los datos de B.
   */
  async enviarConfirmacionReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const { confirmacion } = await this.obtenerPlantillas();
    const comercial = await this.datosComercialesDelNegocio();
    const mensaje = this.reemplazarVariables(confirmacion, datos, comercial);
    if (datos.negocioId) {
      return this.enviarMensaje(datos.telefono, mensaje, datos.negocioId);
    }
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía el recordatorio automático previo a la cita utilizando la plantilla configurada.
   *
   * @remarks
   * Automatización y Retención:
   * Diseñado para ejecutarse desde el cron/worker de recordatorios según los minutos
   * de anticipación configurados en la sede. Enmascara el número en logs para cumplimiento OWASP.
   *
   * @param datos - Parámetros de la cita (cliente, barbero, servicio, fecha, hora, teléfono, negocioId)
   * @returns Promesa que resuelve `true` si el mensaje fue enviado con éxito, o `false` si falló
   */
  async enviarRecordatorioReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const { recordatorio } = await this.obtenerPlantillas();
    const comercial = await this.datosComercialesDelNegocio();
    const mensaje = this.reemplazarVariables(recordatorio, datos, comercial);
    if (datos.negocioId) {
      return this.enviarMensaje(datos.telefono, mensaje, datos.negocioId);
    }
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Notifica al cliente la cancelación de su cita vía WhatsApp.
   *
   * @remarks
   * Experiencia de Cliente y Reagendamiento:
   * Informa oportunamente la liberación del turno e invita al cliente a agendar
   * nuevamente preservando el canal de comunicación y la identidad de marca de la sede.
   *
   * @param datos - Datos del cliente y de la cita cancelada
   * @returns Promesa que resuelve `true` si el mensaje fue emitido exitosamente
   */
  async enviarCancelacionReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const comercial = await this.datosComercialesDelNegocio();
    const mensaje = WhatsAppTemplateEngine.construirCancelacion(
      datos,
      comercial,
    );

    if (datos.negocioId) {
      return this.enviarMensaje(datos.telefono, mensaje, datos.negocioId);
    }
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Envía mensaje de agradecimiento y fidelización tras marcar la cita como completada.
   *
   * @remarks
   * Fidelización Post-Servicio:
   * Refuerza la relación comercial tras la atención exitosa del barbero en la sede.
   *
   * @param datos - Datos del cliente, servicio recibido y sede
   * @returns Promesa que resuelve `true` si el mensaje fue transmitido
   */
  async enviarCompletadoReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const comercial = await this.datosComercialesDelNegocio();
    const mensaje = WhatsAppTemplateEngine.construirCompletada(
      datos,
      comercial,
    );

    if (datos.negocioId) {
      return this.enviarMensaje(datos.telefono, mensaje, datos.negocioId);
    }
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Notifica al cliente cuando su cita ha sido modificada de fecha, hora o barbero.
   *
   * @remarks
   * Consistencia Operativa:
   * Proporciona de inmediato el nuevo itinerario para evitar confusiones o ausencias en la sede.
   *
   * @param datos - Parámetros actualizados de la cita (nueva fecha, nueva hora, profesional)
   * @returns Promesa que resuelve `true` si la notificación fue enviada
   */
  async enviarReprogramacionReserva(
    datos: DatosConfirmacionWhatsApp,
  ): Promise<boolean> {
    const comercial = await this.datosComercialesDelNegocio();
    const mensaje = WhatsAppTemplateEngine.construirReprogramacion(
      datos,
      comercial,
    );

    if (datos.negocioId) {
      return this.enviarMensaje(datos.telefono, mensaje, datos.negocioId);
    }
    return this.enviarMensaje(datos.telefono, mensaje);
  }

  /**
   * Encola un mensaje en memoria para ser despachado automáticamente cuando WhatsApp reconecte.
   * Si ya existía un mensaje encolado para esa misma reserva, lo reemplaza con los datos más recientes.
   */
  encolarMensaje(mensaje: MensajeColaWhatsApp): void {
    this.queueManager.encolar(mensaje);
  }

  /**
   * Elimina cualquier mensaje en cola asociado a una reserva.
   * Invocado al cancelar o reprogramar una cita para prevenir envíos de datos obsoletos.
   */
  cancelarMensajesPendientesDeReserva(
    reservaId: number,
    negocioIdParam?: number,
  ): void {
    const negocioId = this.resolverNegocioId(negocioIdParam);
    this.queueManager.cancelarPorReserva(reservaId, negocioId);
  }

  /**
   * Despacha los mensajes encolados de una sede tras reconectarse el socket de WhatsApp.
   * Aplica verificación Just-in-Time en BD, caducidad TTL y cadencia humana (1.5s).
   */
  async despacharColaPendiente(negocioId: number): Promise<void> {
    const cola = this.queueManager.extraerCola(negocioId);
    if (!cola || cola.length === 0) return;

    this.logger.log(
      `[Negocio ${negocioId}] Procesando cola de ${cola.length} mensaje(s) pendiente(s) tras reconexión...`,
    );

    const ahora = Date.now();
    await this.procesarMensajesSecuenciales(cola, 0, ahora);
  }

  private async procesarMensajesSecuenciales(
    cola: MensajeColaWhatsApp[],
    indice: number,
    ahora: number,
  ): Promise<void> {
    if (indice >= cola.length) return;

    const mensaje = cola[indice];
    const debeEnviar = await this.esMensajeValidoParaDespachar(mensaje, ahora);

    if (debeEnviar) {
      await this.ejecutarEnvioCola(mensaje);
      if (indice + 1 < cola.length) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    return this.procesarMensajesSecuenciales(cola, indice + 1, ahora);
  }

  private async esMensajeValidoParaDespachar(
    mensaje: MensajeColaWhatsApp,
    ahora: number,
  ): Promise<boolean> {
    return this.queueManager.esMensajeValidoParaDespachar(
      this.prisma,
      mensaje,
      ahora,
    );
  }

  private async ejecutarEnvioCola(mensaje: MensajeColaWhatsApp): Promise<void> {
    try {
      if (mensaje.tipo === 'CONFIRMACION') {
        await this.enviarConfirmacionReserva(mensaje.payload);
      } else {
        await this.enviarReprogramacionReserva(mensaje.payload);
      }
      this.logger.log(
        `[Negocio ${mensaje.negocioId}] Mensaje de ${mensaje.tipo} para reserva #${mensaje.reservaId} despachado exitosamente tras reconexión.`,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `[Negocio ${mensaje.negocioId}] Fallo al despachar ${mensaje.tipo} reserva #${mensaje.reservaId}: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}

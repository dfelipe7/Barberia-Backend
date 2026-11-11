import { DatosConfirmacionWhatsApp } from '../types/whatsapp.types';

/**
 * Motor especializado en el renderizado y combinación de plantillas de texto para WhatsApp.
 */
export class WhatsAppTemplateEngine {
  /**
   * Reemplaza variables dinámicas en una plantilla con los datos de la reserva y del negocio.
   *
   * @param plantilla - Texto con placeholders (`{cliente}`, `{servicio}`, `{fecha}`, etc.).
   * @param datos - Información de la cita.
   * @param comercial - Nombre y dirección física de la barbería.
   * @returns Mensaje final listo para enviar.
   */
  static renderizar(
    plantilla: string,
    datos: DatosConfirmacionWhatsApp,
    comercial?: { nombre: string; direccion: string },
  ): string {
    const precioTexto = datos.precio
      ? `\n💰 *Valor:* $${Number(datos.precio).toLocaleString('es-CO')}`
      : '';

    const nombreNegocio = comercial?.nombre?.trim() ?? '';
    const direccion = comercial?.direccion?.trim() ?? '';

    const conComerciales = plantilla
      .replaceAll('{negocio}', nombreNegocio)
      .replace(
        /📍 \*Ubicación:\* \{ubicacion\}\n?/g,
        direccion ? `📍 *Ubicación:* ${direccion}\n` : '',
      );

    const textoBase = conComerciales
      .replaceAll('{cliente}', datos.clienteNombre)
      .replaceAll('{servicio}', datos.servicioNombre)
      .replaceAll('{barbero}', datos.barberoNombre)
      .replaceAll('{fecha}', datos.fecha)
      .replaceAll('{hora}', datos.hora)
      .replaceAll('{precio}', precioTexto)
      .replaceAll('{ubicacion}', direccion);

    if (datos.enlaceGestion) {
      return (
        `${textoBase}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📲 *¿Deseas cambiar o cancelar tu cita?*\n` +
        `Puedes gestionarla en este enlace:\n` +
        `${datos.enlaceGestion}\n` +
        `━━━━━━━━━━━━━━━━━━━━`
      );
    }

    return textoBase;
  }

  /**
   * Construye el texto formal de notificación de cancelación.
   */
  static construirCancelacion(
    datos: DatosConfirmacionWhatsApp,
    comercial: { nombre: string; direccion: string },
  ): string {
    const ubicacion = comercial.direccion
      ? `\n📍 *Ubicación:* ${comercial.direccion}`
      : '';

    return (
      `❌ *CITA CANCELADA - ${comercial.nombre}*\n` +
      `Hola ${datos.clienteNombre}, te confirmamos que tu cita de ${datos.servicioNombre} para el día *${datos.fecha}* a las *${datos.hora}* ha sido cancelada.\n\n` +
      `Si deseas volver a agendar, puedes hacerlo en cualquier momento desde nuestro sitio web o escribiéndonos aquí. ¡Esperamos verte pronto!` +
      ubicacion
    );
  }

  /**
   * Construye el mensaje de agradecimiento cuando la cita fue completada.
   */
  static construirCompletada(
    datos: DatosConfirmacionWhatsApp,
    comercial: { nombre: string },
  ): string {
    return (
      `✅ *CITA COMPLETADA - ${comercial.nombre}*\n` +
      `¡Hola ${datos.clienteNombre}! Tu cita de ${datos.servicioNombre} del día *${datos.fecha}* a las *${datos.hora}* ha sido marcada como completada.\n\n` +
      `¡Gracias por tu visita! Esperamos verte de nuevo pronto en ${comercial.nombre}.`
    );
  }

  /**
   * Construye el mensaje de cita reprogramada.
   */
  static construirReprogramacion(
    datos: DatosConfirmacionWhatsApp,
    comercial: { nombre: string; direccion: string },
  ): string {
    const ubicacion = comercial.direccion
      ? `\n📍 *Ubicación:* ${comercial.direccion}\n`
      : '';

    return (
      `🔄 *CITA REPROGRAMADA - ${comercial.nombre}*\n` +
      `¡Hola ${datos.clienteNombre}! Tu cita ha sido actualizada con éxito:\n\n` +
      `📅 *Nueva Fecha:* ${datos.fecha}\n` +
      `⏰ *Nueva Hora:* ${datos.hora}\n` +
      `✂️ *Servicio:* ${datos.servicioNombre}\n` +
      `💈 *Barbero:* ${datos.barberoNombre}\n` +
      ubicacion +
      `_¡Te esperamos!_`
    );
  }
}

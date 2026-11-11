/**
 * Utilidades puras para formateo, enmascaramiento y sanitización de identificadores de WhatsApp.
 */

/**
 * Enmascara un número telefónico o JID para proteger la privacidad en logs (Auditoría / OWASP).
 * Ejemplo: "3187594854" -> "318****854", "573187594854@s.whatsapp.net" -> "57318****854@s.whatsapp.net"
 *
 * @param identificador - Número de teléfono o JID de WhatsApp.
 * @returns Cadena anonimizada con asteriscos centrales.
 */
export function enmascararTelefono(identificador?: string | null): string {
  if (!identificador) return '***';
  if (identificador.includes('@')) {
    const [num, domain] = identificador.split('@');
    return `${enmascararTelefono(num)}@${domain}`;
  }
  const limpio = identificador.trim();
  if (limpio.length <= 4) return '****';
  const inicio = limpio.slice(0, 3);
  const fin = limpio.slice(-3);
  return `${inicio}****${fin}`;
}

/**
 * Normaliza y formatea un número de teléfono crudo a un JID oficial de WhatsApp (`@s.whatsapp.net`).
 * Aplica reglas para números celulares colombianos (10 dígitos con prefijo 3) e internacionales.
 *
 * @param telefono - Cadena con el número a normalizar.
 * @returns JID listo para Baileys o `null` si el número es inválido.
 */
export function formatearNumeroAJid(telefono: string): string | null {
  if (!telefono) return null;
  const limpio = telefono.replace(/\D/g, '');

  // Formato local colombiano de 10 dígitos (ej. 3187594854 -> 573187594854)
  if (limpio.length === 10 && limpio.startsWith('3')) {
    return `57${limpio}@s.whatsapp.net`;
  }
  // Formato con código de país Colombia (ej. 573187594854)
  if (limpio.length === 12 && limpio.startsWith('573')) {
    return `${limpio}@s.whatsapp.net`;
  }
  // Formatos internacionales generales (mínimo 8 dígitos)
  if (limpio.length >= 8) {
    return `${limpio}@s.whatsapp.net`;
  }
  return null;
}

/**
 * Detecta mensajes ruidosos de depuración de libsignal para silenciarlos en consola.
 */
export function esLogRuidosoLibsignal(...args: unknown[]): boolean {
  const text = args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a && typeof a === 'object' && 'message' in a) {
        const msg = (a as { message?: unknown }).message;
        return typeof msg === 'string' ? msg : '';
      }
      return '';
    })
    .join(' ');
  return (
    text.includes('Closing session:') ||
    text.includes('Closing open session') ||
    text.includes('Decrypted message with closed session') ||
    text.includes('Failed to decrypt message') ||
    text.includes('Bad MAC') ||
    text.includes('Session error')
  );
}

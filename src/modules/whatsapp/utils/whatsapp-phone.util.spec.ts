import {
  enmascararTelefono,
  formatearNumeroAJid,
  esLogRuidosoLibsignal,
} from './whatsapp-phone.util';

describe('whatsapp-phone.util', () => {
  describe('enmascararTelefono', () => {
    it('retorna "***" cuando el teléfono es nulo o vacío', () => {
      expect(enmascararTelefono(null)).toBe('***');
      expect(enmascararTelefono(undefined)).toBe('***');
      expect(enmascararTelefono('')).toBe('***');
    });

    it('enmascara correctamente un número con dominio @s.whatsapp.net', () => {
      const resultado = enmascararTelefono('573187594854@s.whatsapp.net');
      expect(resultado).toBe('573****854@s.whatsapp.net');
    });

    it('retorna "****" para números muy cortos (<= 4 dígitos)', () => {
      expect(enmascararTelefono('123')).toBe('****');
      expect(enmascararTelefono('1234')).toBe('****');
    });

    it('enmascara los dígitos centrales de un teléfono celular común', () => {
      expect(enmascararTelefono('3187594854')).toBe('318****854');
      expect(enmascararTelefono('12345678')).toBe('123****678');
    });
  });

  describe('formatearNumeroAJid', () => {
    it('retorna null cuando el número es vacío', () => {
      expect(formatearNumeroAJid('')).toBeNull();
    });

    it('formatea número celular colombiano de 10 dígitos que inicia con 3', () => {
      expect(formatearNumeroAJid('3187594854')).toBe(
        '573187594854@s.whatsapp.net',
      );
      expect(formatearNumeroAJid('+57 (318) 759-4854')).toBe(
        '573187594854@s.whatsapp.net',
      );
    });

    it('formatea número celular colombiano de 12 dígitos que inicia con 573', () => {
      expect(formatearNumeroAJid('573187594854')).toBe(
        '573187594854@s.whatsapp.net',
      );
    });

    it('formatea números internacionales de 8 o más dígitos', () => {
      expect(formatearNumeroAJid('14155552671')).toBe(
        '14155552671@s.whatsapp.net',
      );
      expect(formatearNumeroAJid('12345678')).toBe('12345678@s.whatsapp.net');
    });

    it('retorna null para números demasiado cortos (< 8 dígitos)', () => {
      expect(formatearNumeroAJid('1234567')).toBeNull();
      expect(formatearNumeroAJid('abc')).toBeNull();
    });
  });

  describe('esLogRuidosoLibsignal', () => {
    it('identifica mensajes de depuración típicos de libsignal', () => {
      expect(
        esLogRuidosoLibsignal('Closing session: 57318@s.whatsapp.net'),
      ).toBe(true);
      expect(esLogRuidosoLibsignal('Closing open session')).toBe(true);
      expect(
        esLogRuidosoLibsignal('Decrypted message with closed session'),
      ).toBe(true);
      expect(esLogRuidosoLibsignal('Failed to decrypt message')).toBe(true);
      expect(esLogRuidosoLibsignal('Bad MAC')).toBe(true);
      expect(esLogRuidosoLibsignal('Session error')).toBe(true);
    });

    it('identifica mensajes dentro de objetos de error con propiedad message', () => {
      expect(
        esLogRuidosoLibsignal({ message: 'Session error in cipher' }),
      ).toBe(true);
      expect(esLogRuidosoLibsignal({ message: 123 })).toBe(false);
      expect(esLogRuidosoLibsignal(null, undefined, 42)).toBe(false);
    });

    it('retorna false para mensajes de log normales y de negocio', () => {
      expect(esLogRuidosoLibsignal('Cita confirmada exitosamente')).toBe(false);
      expect(esLogRuidosoLibsignal('Socket conectado al servidor')).toBe(false);
    });
  });
});

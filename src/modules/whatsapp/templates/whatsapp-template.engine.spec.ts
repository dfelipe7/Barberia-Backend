import { WhatsAppTemplateEngine } from './whatsapp-template.engine';
import { DatosConfirmacionWhatsApp } from '../types/whatsapp.types';

describe('WhatsAppTemplateEngine', () => {
  const datosMock: DatosConfirmacionWhatsApp = {
    telefono: '3187594854',
    clienteNombre: 'Carlos Gomez',
    servicioNombre: 'Corte VIP y Barba',
    barberoNombre: 'Mateo Lopez',
    fecha: '15/11/2026',
    hora: '14:30',
    precio: 45000,
    enlaceGestion: 'https://barberia.app/elite/reserva/123?token=xyz',
  };

  const comercialMock = {
    nombre: 'Barbería Elite VIP',
    direccion: 'Calle 100 # 15-20, Bogotá',
  };

  describe('renderizar', () => {
    it('reemplaza correctamente todas las variables básicas de la cita', () => {
      const plantilla =
        'Hola {cliente}, tu cita de {servicio} con {barbero} es el {fecha} a las {hora}. {precio}';
      const resultado = WhatsAppTemplateEngine.renderizar(
        plantilla,
        datosMock,
        comercialMock,
      );

      expect(resultado).toContain('Hola Carlos Gomez');
      expect(resultado).toContain('Corte VIP y Barba');
      expect(resultado).toContain('Mateo Lopez');
      expect(resultado).toContain('15/11/2026');
      expect(resultado).toContain('14:30');
      expect(resultado).toContain('45.000');
      expect(resultado).toContain(
        'https://barberia.app/elite/reserva/123?token=xyz',
      );
    });

    it('incluye ubicación comercial si la plantilla lo solicita', () => {
      const plantilla =
        'Cita en {negocio}. 📍 *Ubicación:* {ubicacion}\nTe esperamos!';
      const resultado = WhatsAppTemplateEngine.renderizar(
        plantilla,
        datosMock,
        comercialMock,
      );

      expect(resultado).toContain('Cita en Barbería Elite VIP.');
      expect(resultado).toContain('📍 *Ubicación:* Calle 100 # 15-20, Bogotá');
    });

    it('maneja ausencia de datos de precio y de enlace de gestión', () => {
      const sinPrecio: DatosConfirmacionWhatsApp = {
        ...datosMock,
        precio: undefined,
        enlaceGestion: undefined,
      };
      const plantilla = 'Hola {cliente}, servicio {servicio}{precio}';
      const resultado = WhatsAppTemplateEngine.renderizar(plantilla, sinPrecio);

      expect(resultado).toBe('Hola Carlos Gomez, servicio Corte VIP y Barba');
      expect(resultado).not.toContain('¿Deseas cambiar o cancelar tu cita?');
    });
  });

  describe('construirCancelacion', () => {
    it('construye el mensaje de cancelación con dirección comercial', () => {
      const resultado = WhatsAppTemplateEngine.construirCancelacion(
        datosMock,
        comercialMock,
      );

      expect(resultado).toContain('❌ *CITA CANCELADA - Barbería Elite VIP*');
      expect(resultado).toContain('Carlos Gomez');
      expect(resultado).toContain('Corte VIP y Barba');
      expect(resultado).toContain('Calle 100 # 15-20, Bogotá');
    });

    it('construye el mensaje de cancelación sin dirección comercial si está vacía', () => {
      const resultado = WhatsAppTemplateEngine.construirCancelacion(datosMock, {
        nombre: 'Barbería Centro',
        direccion: '',
      });

      expect(resultado).toContain('❌ *CITA CANCELADA - Barbería Centro*');
      expect(resultado).not.toContain('📍 *Ubicación:*');
    });
  });

  describe('construirCompletada', () => {
    it('construye el mensaje de felicitación por cita completada', () => {
      const resultado = WhatsAppTemplateEngine.construirCompletada(
        datosMock,
        comercialMock,
      );

      expect(resultado).toContain('✅ *CITA COMPLETADA - Barbería Elite VIP*');
      expect(resultado).toContain('¡Hola Carlos Gomez!');
      expect(resultado).toContain('¡Gracias por tu visita!');
    });
  });

  describe('construirReprogramacion', () => {
    it('construye el mensaje de cita reprogramada con nuevos horarios', () => {
      const resultado = WhatsAppTemplateEngine.construirReprogramacion(
        datosMock,
        comercialMock,
      );

      expect(resultado).toContain(
        '🔄 *CITA REPROGRAMADA - Barbería Elite VIP*',
      );
      expect(resultado).toContain('📅 *Nueva Fecha:* 15/11/2026');
      expect(resultado).toContain('⏰ *Nueva Hora:* 14:30');
      expect(resultado).toContain('💈 *Barbero:* Mateo Lopez');
      expect(resultado).toContain('Calle 100 # 15-20, Bogotá');
    });
  });
});

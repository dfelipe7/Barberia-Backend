import {
  decidirTransferenciaDireccion,
  dependeDelRespaldoHeredado,
  esDireccionValida,
  EstadoDireccionNegocio,
} from './migracion-direccion.service';

describe('migración controlada de la dirección comercial', () => {
  const base: EstadoDireccionNegocio = {
    slug: 'kyrios-studio',
    nombre: 'KYRIOS STUDIO',
    estado: 'ACTIVO',
    direccionPerfil: null,
    direccionHeredada: null,
    tienePerfil: false,
  };

  describe('esDireccionValida', () => {
    it('acepta un texto con letras o números', () => {
      expect(esDireccionValida('Vía al Bosque, Tv 9A Norte')).toBe(true);
      expect(esDireccionValida('  Calle 1 # 2-3  ')).toBe(true);
      expect(esDireccionValida('123')).toBe(true);
    });

    it('rechaza un valor vacío o solo con puntuación', () => {
      expect(esDireccionValida('')).toBe(false);
      expect(esDireccionValida('   ')).toBe(false);
      expect(esDireccionValida('-')).toBe(false);
      expect(esDireccionValida(null)).toBe(false);
      expect(esDireccionValida(undefined)).toBe(false);
    });
  });

  describe('decidirTransferenciaDireccion', () => {
    it('NUNCA sobrescribe una dirección ya configurada en el perfil', () => {
      const decision = decidirTransferenciaDireccion({
        ...base,
        direccionPerfil: 'Dirección Del Perfil',
        direccionHeredada: 'Dirección Antigua',
        tienePerfil: true,
      });

      expect(decision.accion).toBe('conservar');
    });

    it('omite la transferencia si el valor heredado está vacío', () => {
      const decision = decidirTransferenciaDireccion({
        ...base,
        direccionHeredada: '',
        tienePerfil: true,
      });

      expect(decision.accion).toBe('omitir');
    });

    it('omite la transferencia si no hay valor heredado', () => {
      const decision = decidirTransferenciaDireccion(base);

      expect(decision.accion).toBe('omitir');
    });

    it('transfiere el valor heredado cuando el perfil no tiene dirección', () => {
      const decision = decidirTransferenciaDireccion({
        ...base,
        direccionHeredada: '  Vía al Bosque, Tv 9A Norte  ',
        tienePerfil: true,
      });

      expect(decision.accion).toBe('transferir');
      expect(decision.accion === 'transferir' ? decision.direccion : '').toBe(
        'Vía al Bosque, Tv 9A Norte',
      );
    });

    it('transfiere también cuando el negocio no tiene perfil', () => {
      const decision = decidirTransferenciaDireccion({
        ...base,
        direccionHeredada: 'Dirección Heredada',
        tienePerfil: false,
      });

      expect(decision.accion).toBe('transferir');
    });
  });

  describe('dependeDelRespaldoHeredado', () => {
    it('es true solo si hay valor heredado y el perfil no tiene dirección', () => {
      expect(
        dependeDelRespaldoHeredado({
          ...base,
          direccionHeredada: 'Dirección Antigua',
        }),
      ).toBe(true);

      expect(
        dependeDelRespaldoHeredado({
          ...base,
          direccionHeredada: 'Dirección Antigua',
          direccionPerfil: 'Dirección Del Perfil',
          tienePerfil: true,
        }),
      ).toBe(false);

      expect(dependeDelRespaldoHeredado(base)).toBe(false);
    });
  });
});

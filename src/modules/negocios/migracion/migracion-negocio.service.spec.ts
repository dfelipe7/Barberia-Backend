import {
  CLAVES_CONFIGURACION_OPERATIVA,
  MODELOS_CON_NEGOCIO,
  REGEX_SLUG_NEGOCIO,
} from './migracion-negocio.constants';
import {
  decidirConfiguracionOperativa,
  decidirInicializacion,
  ejecutarBackfill,
  reconciliar,
} from './migracion-negocio.service';

describe('Lógica de migración al modelo multitenant (sin base de datos)', () => {
  describe('decidirInicializacion', () => {
    it('crea el negocio cuando la plataforma está vacía', () => {
      const decision = decidirInicializacion(
        { nombre: 'KYRIOS STUDIO', slug: 'kyrios-studio' },
        { totalNegocios: 0 },
      );

      expect(decision).toEqual({
        accion: 'crear',
        nombre: 'KYRIOS STUDIO',
        slug: 'kyrios-studio',
      });
    });

    it('reutiliza el negocio existente sin duplicarlo ni sobrescribirlo', () => {
      const decision = decidirInicializacion(
        { nombre: 'KYRIOS STUDIO', slug: 'kyrios-studio' },
        {
          negocioConSlug: { id: 7, slug: 'kyrios-studio', nombre: 'Editado' },
          totalNegocios: 1,
        },
      );

      expect(decision).toEqual({
        accion: 'reutilizar',
        negocioId: 7,
        slug: 'kyrios-studio',
      });
    });

    it('rechaza si ya hay negocios con otro slug', () => {
      const decision = decidirInicializacion(
        { nombre: 'KYRIOS STUDIO', slug: 'kyrios-studio' },
        {
          negocioConSlug: undefined,
          totalNegocios: 2,
        },
      );

      expect(decision.accion).toBe('rechazar');
      expect(decision.accion === 'rechazar' ? decision.motivo : '').toContain(
        'ya tiene 2 negocio(s)',
      );
    });

    it('rechaza un nombre vacío', () => {
      const decision = decidirInicializacion(
        { nombre: '   ', slug: 'kyrios-studio' },
        { totalNegocios: 0 },
      );

      expect(decision.accion).toBe('rechazar');
    });

    it('rechaza un slug vacío', () => {
      const decision = decidirInicializacion(
        { nombre: 'KYRIOS STUDIO', slug: '' },
        { totalNegocios: 0 },
      );

      expect(decision.accion).toBe('rechazar');
    });

    it('normaliza el slug a minúsculas', () => {
      const decision = decidirInicializacion(
        { nombre: 'KYRIOS STUDIO', slug: '  KYRIOS-Studio  ' },
        { totalNegocios: 0 },
      );

      expect(decision).toEqual({
        accion: 'crear',
        nombre: 'KYRIOS STUDIO',
        slug: 'kyrios-studio',
      });
    });

    describe('formato del slug', () => {
      const acepta = (slug: string) =>
        decidirInicializacion({ nombre: 'N', slug }, { totalNegocios: 0 })
          .accion === 'crear';

      it('admite a-z, 0-9 y guiones', () => {
        expect(acepta('kyrios-studio')).toBe(true);
        expect(acepta('k')).toBe(true);
        expect(acepta('barberia2')).toBe(true);
        expect(acepta('a-b-c-1-2')).toBe(true);
      });

      it('rechaza caracteres fuera del conjunto permitido', () => {
        expect(acepta('barberia_prueba')).toBe(false);
        expect(acepta('barbería')).toBe(false);
        expect(acepta('barberia prueba')).toBe(false);
        expect(acepta('barberia/abc')).toBe(false);
        expect(acepta('barberia.abc')).toBe(false);
      });

      it('rechaza guiones en los extremos', () => {
        expect(acepta('-barberia')).toBe(false);
        expect(acepta('barberia-')).toBe(false);
      });

      it('rechaza un slug de más de 63 caracteres', () => {
        expect(acepta('a'.repeat(64))).toBe(false);
        expect(acepta('a'.repeat(63))).toBe(true);
      });

      it('el regex coincide con el formato documentado', () => {
        expect(REGEX_SLUG_NEGOCIO.test('kyrios-studio')).toBe(true);
        expect(REGEX_SLUG_NEGOCIO.test('KYRIOS')).toBe(false);
      });
    });
  });

  describe('decidirConfiguracionOperativa', () => {
    const config = CLAVES_CONFIGURACION_OPERATIVA[0];

    it('crea la configuración con el valor global vigente', () => {
      const decision = decidirConfiguracionOperativa(config, {
        valorGlobal: {
          valor: '90',
          tipo: 'NUMERO',
          descripcion: 'Antelación',
        },
      });

      expect(decision).toEqual({
        accion: 'crear',
        valor: '90',
        tipo: 'NUMERO',
        descripcion: 'Antelación',
      });
    });

    it('usa el valor por defecto conocido si no hay valor global', () => {
      const decision = decidirConfiguracionOperativa(config, {});

      expect(decision.accion).toBe('crear');
      expect(decision.accion === 'crear' ? decision.valor : '').toBe(
        config.valorPorDefecto,
      );
    });

    it('CONSERVA el valor ya personalizado en el negocio', () => {
      const decision = decidirConfiguracionOperativa(config, {
        valorEnNegocio: { valor: '45' },
        valorGlobal: { valor: '120', tipo: 'NUMERO', descripcion: 'X' },
      });

      expect(decision).toEqual({ accion: 'conservar', valor: '45' });
    });

    it('conserva el valor personalizado aunque el global haya cambiado', () => {
      const decision = decidirConfiguracionOperativa(config, {
        valorEnNegocio: { valor: '45' },
        valorGlobal: { valor: '999', tipo: 'NUMERO', descripcion: 'X' },
      });

      expect(decision.accion).toBe('conservar');
    });
  });

  describe('ejecutarBackfill', () => {
    it('recorre TODOS los modelos por negocio', async () => {
      const ejecutarLote = jest.fn().mockResolvedValue(0);
      const contarSinNegocio = jest.fn().mockResolvedValue(0);

      const resultado = await ejecutarBackfill(
        ejecutarLote,
        contarSinNegocio,
        1,
        1000,
      );

      const tablasRecorridas = ejecutarLote.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );

      expect(tablasRecorridas).toEqual(MODELOS_CON_NEGOCIO.map((m) => m.tabla));
      expect(resultado.total).toBe(0);
      expect(resultado.pendientes).toEqual([]);
    });

    it('acumula las filas actualizadas por modelo', async () => {
      const ejecutarLote = jest
        .fn()
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(3)
        .mockResolvedValue(0);
      const contarSinNegocio = jest.fn().mockResolvedValue(0);

      const resultado = await ejecutarBackfill(
        ejecutarLote,
        contarSinNegocio,
        1,
        1000,
      );

      // El primer modelo: 1000 + 3 (lote incompleto) = 1003.
      expect(resultado.actualizadasPorModelo[0].actualizadas).toBe(1003);
    });

    it('es idempotente: la segunda ejecución no actualiza filas', async () => {
      // Primera ejecución: quedan filas. Segunda: no hay nada que asignar.
      const pendientes = new Map<string, number>();
      const ejecutarLote = jest.fn((tabla: string, lote: number) => {
        const restantes = pendientes.get(tabla) ?? 0;
        const afectadas = Math.min(lote, restantes);
        pendientes.set(tabla, restantes - afectadas);
        return Promise.resolve(afectadas);
      });
      const contarSinNegocio = jest.fn((tabla: string) => {
        return Promise.resolve(pendientes.get(tabla) ?? 0);
      });

      for (const modelo of MODELOS_CON_NEGOCIO) {
        pendientes.set(modelo.tabla, 2);
      }

      const primera = await ejecutarBackfill(
        ejecutarLote,
        contarSinNegocio,
        1,
        1000,
      );
      const segunda = await ejecutarBackfill(
        ejecutarLote,
        contarSinNegocio,
        1,
        1000,
      );

      expect(primera.total).toBe(MODELOS_CON_NEGOCIO.length * 2);
      expect(segunda.total).toBe(0);
    });

    it('detecta los modelos que conservan filas sin negocio', async () => {
      const ejecutarLote = jest.fn().mockResolvedValue(0);
      const contarSinNegocio = jest
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(5);

      const resultado = await ejecutarBackfill(
        ejecutarLote,
        contarSinNegocio,
        1,
        1000,
      );

      expect(resultado.pendientes).toHaveLength(1);
      expect(resultado.pendientes[0].sinNegocio).toBe(5);
    });

    it('rechaza un tamaño de lote inválido', async () => {
      await expect(
        ejecutarBackfill(jest.fn(), jest.fn(), 1, 0),
      ).rejects.toThrow(/tamaño de lote/);

      await expect(
        ejecutarBackfill(jest.fn(), jest.fn(), 1, -1),
      ).rejects.toThrow(/tamaño de lote/);
    });
  });

  describe('reconciliar', () => {
    it('es correcta cuando no quedan registros sin negocio', () => {
      const resultado = reconciliar({
        actualizadasPorModelo: [],
        total: 12,
        pendientes: [],
      });

      expect(resultado.correcto).toBe(true);
      expect(resultado.mensaje).toContain('12');
    });

    it('es incorrecta cuando quedan registros sin negocio', () => {
      const resultado = reconciliar({
        actualizadasPorModelo: [],
        total: 12,
        pendientes: [{ modelo: 'cliente', tabla: 'Cliente', sinNegocio: 3 }],
      });

      expect(resultado.correcto).toBe(false);
      expect(resultado.mensaje).toContain('Cliente: 3');
    });
  });

  describe('inventario de modelos', () => {
    it('cubre los nueve modelos asociados a un negocio', () => {
      expect(MODELOS_CON_NEGOCIO).toHaveLength(9);
      expect(MODELOS_CON_NEGOCIO.map((m) => m.tabla)).toEqual([
        'Administrador',
        'Barbero',
        'Cliente',
        'Servicio',
        'BarberoServicio',
        'reservations',
        'barber_weekly_slots',
        'barber_schedule_blocks',
        'general_closures',
      ]);
    });

    it('no incluye los modelos globales', () => {
      const tablas = MODELOS_CON_NEGOCIO.map((m) => m.tabla);

      expect(tablas).not.toContain('Usuario');
      expect(tablas).not.toContain('negocios');
      expect(tablas).not.toContain('configuraciones_sistema');
      expect(tablas).not.toContain('whatsapp_plantillas');
    });

    it('las claves operativas son las esperadas', () => {
      expect(CLAVES_CONFIGURACION_OPERATIVA.map((c) => c.clave)).toEqual([
        'reserva_cancelacion_antelacion_minutos',
        'reserva_no_show_tolerancia_minutos',
        'negocio_direccion',
        'recordatorio_minutos_anticipacion',
      ]);
    });
  });
});
